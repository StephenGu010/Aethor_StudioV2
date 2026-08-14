using System.Collections.Concurrent;
using AethorStudioV2.Application;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Tests;

public sealed class AethorArmSerialSessionTests
{
    [Fact]
    public async Task FragmentedHelloEstablishesVersionedDeviceIdentity()
    {
        var identities = new ConcurrentQueue<AethorArmSessionIdentity?>();
        var hello = Wire(
            "RSP 1 ok product=aethor-robo controller=controller-01 arm=arm-01 session=831462 "
            + "boot_id=3928421 dof=7 protocol=aethor-arm-ascii-v1 fw=0.1.0 modes=POS_VEL,MIT stream_max_hz=100");
        var transport = new FakeAsciiTransport((line, _) => line.Contains(" HELLO ", StringComparison.Ordinal)
            ? [hello[..37], hello[37..]]
            : []);
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport, identityObserver: identities.Enqueue);

        var response = await QueryAsync(session, 1, "HELLO");

        Assert.Equal(AethorArmFrameKind.Response, response.Kind);
        var identity = session.GetIdentity();
        Assert.NotNull(identity);
        Assert.Equal("controller-01", identity.ControllerId);
        Assert.Equal("arm-01", identity.ArmId);
        Assert.Equal("3928421", identity.BootId);
        Assert.Equal("831462", identity.DeviceSession);
        Assert.Equal(["POS_VEL", "MIT"], identity.SupportedModes);
        Assert.Equal(100, identity.StreamMaximumHz);
        Assert.Equal(identity, Assert.Single(identities));
    }

    [Fact]
    public async Task TaggedQueriesCanCompleteOutOfOrderWithoutHoldingTheWriter()
    {
        var transport = HelloTransport();
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");

        var info = QueryAsync(session, 10, "GET_INFO");
        var state = QueryAsync(session, 11, "GET_STATE");
        await TestWait.UntilAsync(() => transport.Writes.Count == 3);

        transport.PushInbound(WireText("RSP 11 ok state=READY"));
        transport.PushInbound(WireText("RSP 10 ok product=aethor-robo"));

        Assert.Equal("READY", (await state).Fields["state"]);
        Assert.Equal("aethor-robo", (await info).Fields["product"]);
        Assert.Equal(3, session.GetProbeSnapshot().CorrelatedResponses);
    }

    [Fact]
    public async Task DuplicateActiveRequestIdIsRejectedBeforeASecondWrite()
    {
        var transport = HelloTransport();
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");

        var first = QueryAsync(session, 20, "GET_STATE");
        await TestWait.UntilAsync(() => transport.Writes.Count == 2);

        await Assert.ThrowsAsync<GatewayConflictException>(() => QueryAsync(session, 20, "GET_STATE"));
        Assert.Equal(2, transport.Writes.Count);

        transport.PushInbound(WireText("RSP 20 ok state=READY"));
        Assert.Equal("READY", (await first).Fields["state"]);
    }

    [Fact]
    public async Task RetiredRequestIdCannotBeReusedAfterCompletion()
    {
        var transport = new FakeAsciiTransport((line, _) => line.Contains(" GET_STATE ", StringComparison.Ordinal)
            ? [Wire("RSP 21 ok state=READY")]
            : line.Contains(" HELLO ", StringComparison.Ordinal) ? [Wire(HelloBody(1))] : []);
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");

        Assert.Equal("READY", (await QueryAsync(session, 21, "GET_STATE")).Fields["state"]);
        await Assert.ThrowsAsync<GatewayConflictException>(() => QueryAsync(session, 21, "GET_STATE"));
        Assert.Equal(2, transport.Writes.Count);
    }

    [Fact]
    public async Task ValidatedTerminalWriteDoesNotWaitForAReplyOrBlockPendingQuery()
    {
        var transport = HelloTransport();
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");

        var query = QueryAsync(session, 30, "GET_STATE");
        await TestWait.UntilAsync(() => transport.Writes.Count == 2);
        var terminalLine = AethorArmAsciiProtocol.FormatRequest(31, "GET_DIAG");
        var terminal = session.QueueValidatedUnobserved(
            "terminal-31",
            terminalLine,
            SerialWorkPriority.Interactive,
            TimeSpan.FromSeconds(1));

        Assert.True(terminal.Accepted);
        Assert.Equal(SerialWriteOutcome.Written, (await terminal.Completion!).Outcome);
        Assert.Equal(3, transport.Writes.Count);
        Assert.False(query.IsCompleted);

        transport.PushInbound(WireText("RSP 30 ok state=READY"));
        Assert.Equal("READY", (await query).Fields["state"]);
    }

    [Fact]
    public async Task TelemetryProjectsMasksByMotorIdAndPreservesConflictEvidence()
    {
        var transport = HelloTransport();
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");

        transport.PushInbound(WireText(
            "TEL 91 JOINT_STATE t_us=183920040 q_deg=10,20,30,40,50,60,70 "
            + "present_mask=0x45 valid_mask=0x41 conflict_mask=0x04 unexpected_ids=8,12"));
        await TestWait.UntilAsync(() => session.GetProbeSnapshot().ProjectedMotorFrames == 1);

        Assert.True(session.TryReadLatestMotorFrame(out var frame));
        Assert.Equal("left-arm", frame.JointGroupId);
        Assert.Equal([8, 12], frame.UnexpectedMotorIds);
        Assert.Equal([1, 3, 7], frame.Motors.Select(motor => motor.MotorId));
        Assert.Equal([10d, 30d, 70d], frame.Motors.Select(motor => motor.PositionDeg));
        Assert.True(frame.Motors[0].Valid);
        Assert.False(frame.Motors[1].Valid);
        Assert.True(frame.Motors[1].IdentityConflict);
        Assert.Equal(65_535d, frame.Motors[1].FeedbackAgeMs);
        Assert.True(frame.Motors[2].Valid);
    }

    [Fact]
    public async Task GetJposAndTelemetryUseTheSameProjectionBoundary()
    {
        var transport = new FakeAsciiTransport((line, _) =>
        {
            if (line.Contains(" HELLO ", StringComparison.Ordinal))
            {
                return [Wire(HelloBody(1))];
            }
            if (line.Contains(" GET_JPOS ", StringComparison.Ordinal))
            {
                return [Wire(
                    "RSP 2 ok t_us=100 q_deg=1,2,3,4,5,6,7 present_mask=0x03 "
                    + "valid_mask=0x03 conflict_mask=0x00 unexpected_ids=none")];
            }
            return [];
        });
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");

        await QueryAsync(session, 2, "GET_JPOS");
        Assert.True(session.TryReadLatestMotorFrame(out var queried));
        transport.PushInbound(WireText(
            "TEL 3 JOINT_STATE t_us=101 q_deg=11,12,13,14,15,16,17 present_mask=0x03 "
            + "valid_mask=0x03 conflict_mask=0x00 unexpected_ids=none"));
        await TestWait.UntilAsync(() => session.GetProbeSnapshot().ProjectedMotorFrames == 2);

        Assert.True(session.TryReadLatestMotorFrame(out var streamed));
        Assert.Equal([1d, 2d], queried.Motors.Select(motor => motor.PositionDeg));
        Assert.Equal([11d, 12d], streamed.Motors.Select(motor => motor.PositionDeg));
        Assert.Equal(1u, queried.FrameSeq);
        Assert.Equal(2u, streamed.FrameSeq);
    }

    [Fact]
    public async Task InvalidDiscoveryMasksDoNotMutateTheMotorProjection()
    {
        var transport = HelloTransport();
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");

        transport.PushInbound(WireText(
            "TEL 92 JOINT_STATE t_us=1 q_deg=1,2,3,4,5,6,7 present_mask=0x01 "
            + "valid_mask=0x02 conflict_mask=0x00 unexpected_ids=none"));
        await TestWait.UntilAsync(() => session.GetProbeSnapshot().RejectedMotorFrames == 1);

        Assert.False(session.TryReadLatestMotorFrame(out _));
        Assert.Equal(1, session.GetProbeSnapshot().RejectedMotorFrames);
    }

    [Fact]
    public async Task InvalidGetJposPayloadFailsTheCorrelatedQuery()
    {
        var transport = new FakeAsciiTransport((line, _) =>
        {
            if (line.Contains(" HELLO ", StringComparison.Ordinal))
            {
                return [Wire(HelloBody(1))];
            }
            if (line.Contains(" GET_JPOS ", StringComparison.Ordinal))
            {
                return [Wire(
                    "RSP 2 ok t_us=1 q_deg=1,2,3,4,5,6 present_mask=0x7F "
                    + "valid_mask=0x7F conflict_mask=0x00 unexpected_ids=none")];
            }
            return [];
        });
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");

        var error = await Assert.ThrowsAsync<GatewayProtocolException>(() => QueryAsync(session, 2, "GET_JPOS"));

        Assert.Contains("q_deg_invalid", error.Message, StringComparison.Ordinal);
        Assert.False(session.TryReadLatestMotorFrame(out _));
        Assert.Equal(1, session.GetProbeSnapshot().RejectedMotorFrames);
        Assert.Equal(0, session.GetProbeSnapshot().ActiveRequests);
    }

    [Fact]
    public async Task ConflictMaskCanQuarantineAnIdThatIsAbsentFromPresentMask()
    {
        var transport = HelloTransport();
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");

        transport.PushInbound(WireText(
            "TEL 93 JOINT_STATE t_us=1 q_deg=1,2,3,4,5,6,7 present_mask=0x01 "
            + "valid_mask=0x01 conflict_mask=0x04 unexpected_ids=none"));
        await TestWait.UntilAsync(() => session.GetProbeSnapshot().ProjectedMotorFrames == 1);

        Assert.True(session.TryReadLatestMotorFrame(out var frame));
        var conflict = Assert.Single(frame.Motors, motor => motor.MotorId == 3);
        Assert.True(conflict.IdentityConflict);
        Assert.False(conflict.Valid);
    }

    [Fact]
    public async Task FirmwareBootChangeClearsIdentityAndCancelsPendingRequests()
    {
        var transport = HelloTransport();
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");
        var pending = QueryAsync(session, 40, "GET_STATE");
        await TestWait.UntilAsync(() => transport.Writes.Count == 2);

        transport.PushInbound(WireText("EVT 9 BOOT boot_id=boot-2"));

        await Assert.ThrowsAsync<AethorArmFirmwareRestartedException>(() => pending);
        Assert.Null(session.GetIdentity());
        Assert.Equal(1, session.GetProbeSnapshot().BootResets);
        Assert.Equal(0, session.GetProbeSnapshot().ActiveRequests);
    }

    [Fact]
    public async Task RepeatedHelloRenewsTheSessionAndCancelsOlderPendingQueries()
    {
        var transport = new FakeAsciiTransport((line, _) =>
        {
            if (line.Contains(" HELLO ", StringComparison.Ordinal))
            {
                var requestId = AethorArmAsciiProtocol.ParseFrame(line).Frame!.Sequence;
                return [Wire(HelloBody(requestId))];
            }
            return [];
        });
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");
        var staleQuery = QueryAsync(session, 2, "GET_STATE");
        await TestWait.UntilAsync(() => transport.Writes.Count == 2);

        await QueryAsync(session, 3, "HELLO");

        await Assert.ThrowsAsync<AethorArmFirmwareRestartedException>(() => staleQuery);
        Assert.NotNull(session.GetIdentity());
        Assert.Equal(0, session.GetProbeSnapshot().ActiveRequests);
    }

    [Fact]
    public async Task TimeoutReleasesRequestIdAndLateReplyIsReportedAsOrphan()
    {
        var diagnostics = new RecordingGatewayDiagnostics();
        var transport = HelloTransport();
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport, diagnostics: diagnostics);
        await QueryAsync(session, 1, "HELLO");

        await Assert.ThrowsAsync<GatewayQueryTimeoutException>(() => QueryAsync(
            session,
            50,
            "GET_STATE",
            responseTimeout: TimeSpan.FromMilliseconds(50)));
        Assert.Equal(0, session.GetProbeSnapshot().ActiveRequests);

        transport.PushInbound(WireText("RSP 50 ok state=READY"));
        await TestWait.UntilAsync(() => session.GetProbeSnapshot().OrphanResponses == 1);
        Assert.Contains(diagnostics.Events, item => item.EventName == "aethor.session.response.orphan");
    }

    [Fact]
    public async Task SlowTelemetryConsumerIsCoalescedWithoutBlockingSerialParsing()
    {
        var diagnostics = new RecordingGatewayDiagnostics();
        var transport = HelloTransport();
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport, diagnostics: diagnostics);
        await QueryAsync(session, 1, "HELLO");

        transport.PushInbound(WireText(
            "TEL 1 JOINT_STATE t_us=1 q_deg=1,2,3,4,5,6,7 present_mask=0x7F "
            + "valid_mask=0x7F conflict_mask=0x00 unexpected_ids=none"));
        await TestWait.UntilAsync(() => session.GetProbeSnapshot().ProjectedMotorFrames == 1);
        Assert.True(session.TryReadLatestMotorFrame(out var first));
        Assert.Equal(1u, first.FrameSeq);
        var burst = string.Concat(Enumerable.Range(2, 199).Select(index => WireText(
            $"TEL {index} JOINT_STATE t_us={index} q_deg=1,2,3,4,5,6,7 present_mask=0x7F "
            + "valid_mask=0x7F conflict_mask=0x00 unexpected_ids=none")));
        transport.PushInbound(burst);
        await TestWait.UntilAsync(() => session.GetProbeSnapshot().ProjectedMotorFrames == 200);

        var probe = session.GetProbeSnapshot();
        Assert.Equal(200, probe.ProjectedMotorFrames);
        Assert.True(probe.CoalescedMotorFrames > 0);
        Assert.Equal(0, probe.ActiveRequests);
        Assert.DoesNotContain(diagnostics.Events, item => item.EventName == "aethor.session.motor_frame.accepted");
        Assert.True(session.TryReadLatestMotorFrame(out var latest));
        Assert.Equal(200u, latest.FrameSeq);
        Assert.Equal(2, session.GetProbeSnapshot().PublishedMotorFrames);
    }

    [Fact]
    public async Task DisposeClosesTransportOnceAndCancelsEveryPendingRequest()
    {
        var transport = new FakeAsciiTransport((line, _) => line.Contains(" HELLO ", StringComparison.Ordinal)
            ? [Wire(HelloBody(1))]
            : [])
        {
            IgnoreReadCancellation = true
        };
        await transport.OpenAsync(CancellationToken.None);
        var session = CreateSession(transport);
        await QueryAsync(session, 1, "HELLO");
        var first = QueryAsync(session, 60, "GET_INFO");
        var second = QueryAsync(session, 61, "GET_STATE");
        await TestWait.UntilAsync(() => transport.Writes.Count == 3);

        await session.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => second);
        Assert.Equal(1, transport.CloseCount);
        Assert.Equal(1, transport.DisposeCount);
    }

    [Fact]
    public async Task DisposeReleasesAWaitingMotorFrameConsumer()
    {
        var transport = new FakeAsciiTransport((_, _) => [])
        {
            IgnoreReadCancellation = true
        };
        await transport.OpenAsync(CancellationToken.None);
        var session = CreateSession(transport);
        var waitingConsumer = session.WaitForLatestMotorFrameAsync(CancellationToken.None).AsTask();

        await session.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waitingConsumer);
        Assert.Equal(1, transport.CloseCount);
        Assert.Equal(1, transport.DisposeCount);
    }

    private static AethorArmSerialSession CreateSession(
        FakeAsciiTransport transport,
        Action<AethorArmSessionIdentity?>? identityObserver = null,
        IGatewayDiagnostics? diagnostics = null) =>
        new(
            transport,
            AethorArmGatewayContractV1.LeftArmGroupId,
            "host-session-1",
            identityObserver: identityObserver,
            diagnostics: diagnostics);

    private static Task<AethorArmAsciiFrame> QueryAsync(
        AethorArmSerialSession session,
        uint requestId,
        string operation,
        TimeSpan? responseTimeout = null) =>
        session.QueryAsync(
            $"request-{requestId}-{operation}",
            requestId,
            operation,
            fields: operation == "HELLO"
                ? [new("client", "aethor-studio-v2"), new("protocol", "1")]
                : null,
            SerialWorkPriority.Telemetry,
            TimeSpan.FromSeconds(1),
            responseTimeout ?? TimeSpan.FromSeconds(1),
            CancellationToken.None);

    private static FakeAsciiTransport HelloTransport() => new((line, _) =>
        line.Contains(" HELLO ", StringComparison.Ordinal)
            ? [Wire(HelloBody(1))]
            : []);

    private static string HelloBody(uint requestId, string bootId = "3928421") =>
        $"RSP {requestId} ok product=aethor-robo controller=controller-01 arm=arm-01 session=831462 "
        + $"boot_id={bootId} dof=7 protocol=aethor-arm-ascii-v1 fw=0.1.0 modes=POS_VEL,MIT stream_max_hz=100";

    private static string WireText(string body) => System.Text.Encoding.ASCII.GetString(Wire(body));

    private static byte[] Wire(string body)
    {
        var crc = AethorArmAsciiProtocol.ComputeCrc16(body);
        return FakeAsciiTransport.Ascii($"{body} *{crc:X4}\n");
    }
}
