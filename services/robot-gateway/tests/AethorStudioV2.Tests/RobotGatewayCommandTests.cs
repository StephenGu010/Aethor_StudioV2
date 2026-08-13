using AethorStudioV2.Application;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Tests;

public sealed class RobotGatewayCommandTests
{
    [Fact]
    public async Task DefaultPolicyRejectsCommandsWithoutWritingHardware()
    {
        var transport = FakeAsciiTransport.WithDefaultStatus();
        await using var gateway = CreateGateway(transport, CommandsDisabledOptions());
        var session = await ConnectAndWaitAsync(gateway);

        var result = await gateway.EnableAsync(Command("disabled-1", session.SessionId), CancellationToken.None);

        Assert.Equal(CommandStatus.Unsupported, result.Status);
        Assert.Equal(CommandResultCode.CommandsDisabled, result.Code);
        Assert.DoesNotContain(transport.Writes, line => line.StartsWith('!') || line.StartsWith('>') || line.StartsWith('$'));
    }

    [Fact]
    public async Task EnableRequiresAckAndFreshReadbackBeforeCompleted()
    {
        var enabled = false;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii(enabled ? "ok 1\n" : "ok 0\n")],
            "!START" => Enable(),
            _ => []
        });
        IReadOnlyList<byte[]> Enable()
        {
            enabled = true;
            return [FakeAsciiTransport.Ascii("Started ok\n")];
        }

        var events = new RecordingGatewayEventSink();
        await using var gateway = CreateGateway(transport, SupervisedOptions(), events);
        var session = await ConnectAndWaitAsync(gateway);

        var result = await gateway.EnableAsync(Command("enable-1", session.SessionId), CancellationToken.None);

        Assert.Equal(CommandStatus.Completed, result.Status);
        Assert.Equal(CommandEvidence.FeedbackConfirmed, result.Evidence);
        Assert.Equal(MotorState.Enabled, gateway.GetSession().MotorState);
        Assert.Equal(["!START"], transport.Writes.Where(line => line == "!START"));
        await TestWait.UntilAsync(() => events.CommandResults.Any(item => item.CommandId == "enable-1"));
    }

    [Fact]
    public async Task ModeCommandUpdatesAuthoritativeSessionOnlyAfterMatchingReadback()
    {
        var mode = 2;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii(mode == 1 ? "ok 1 SEQ_POINT\n" : "ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 0\n")],
            "#CMDMODE 1" => SetMode(),
            _ => []
        });
        IReadOnlyList<byte[]> SetMode()
        {
            mode = 1;
            return [FakeAsciiTransport.Ascii("ok Set command mode to [1] (SEQ_POINT)\n")];
        }

        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await ConnectAndWaitAsync(gateway);
        var result = await gateway.SetModeAsync(
            new("mode-readback", session.SessionId, GatewayContractV1.DummyProfileId, 1),
            CancellationToken.None);

        Assert.Equal(CommandStatus.Completed, result.Status);
        Assert.Equal(CommandEvidence.FeedbackConfirmed, result.Evidence);
        Assert.Equal(1, gateway.GetSession().ControlMode);
        var audit = Assert.IsType<CommandAuditRecord>(gateway.GetCommand("mode-readback"));
        Assert.Equal(RobotCommandKind.SetMode, audit.Request.CommandKind);
        Assert.Equal(1, audit.Request.Mode);
        Assert.Null(audit.Request.PositionsDeg);
        Assert.Matches("^[0-9A-F]{64}$", audit.Request.RequestFingerprintSha256);
        Assert.Equal(["#CMDMODE 1", "#GETMODE"], audit.TransmittedPayloads);
        Assert.False(audit.TransmissionLogTruncated);
    }

    [Fact]
    public async Task SameCommandIdAndPayloadReusesOnePhysicalExecution()
    {
        var enabled = false;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii(enabled ? "ok 1\n" : "ok 0\n")],
            "!START" => SetEnabled(),
            _ => []
        });
        IReadOnlyList<byte[]> SetEnabled()
        {
            enabled = true;
            return [FakeAsciiTransport.Ascii("Started ok\n")];
        }

        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await ConnectAndWaitAsync(gateway);
        var command = Command("same-id", session.SessionId);

        var results = await Task.WhenAll(
            gateway.EnableAsync(command, CancellationToken.None),
            gateway.EnableAsync(command, CancellationToken.None));

        Assert.All(results, result => Assert.Equal(CommandStatus.Completed, result.Status));
        Assert.Single(transport.Writes, line => line == "!START");
    }

    [Fact]
    public async Task RequestCancelledBeforeAcceptanceCreatesNoCommandOrHardwareWrite()
    {
        var transport = FakeAsciiTransport.WithDefaultStatus();
        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await ConnectAndWaitAsync(gateway);
        using var requestCancellation = new CancellationTokenSource();
        requestCancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            gateway.EnableAsync(Command("cancelled-before-acceptance", session.SessionId), requestCancellation.Token));

        Assert.Null(gateway.GetCommand("cancelled-before-acceptance"));
        Assert.DoesNotContain("!START", transport.Writes);
    }

    [Fact]
    public async Task RequestCancelledAfterAcceptanceDoesNotCancelPhysicalExecutionOrPermitDuplicateWrite()
    {
        var enabled = false;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii(enabled ? "ok 1\n" : "ok 0\n")],
            "!START" => AcceptWithoutImmediateReply(),
            _ => []
        });
        IReadOnlyList<byte[]> AcceptWithoutImmediateReply()
        {
            enabled = true;
            return [];
        }

        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await ConnectAndWaitAsync(gateway);
        var command = Command("cancelled-after-acceptance", session.SessionId);
        using var requestCancellation = new CancellationTokenSource();
        var interruptedWait = gateway.EnableAsync(command, requestCancellation.Token);
        await TestWait.UntilAsync(() => transport.Writes.Contains("!START"));

        requestCancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => interruptedWait);
        transport.PushInbound("Started ok\n");

        var recovered = await gateway.EnableAsync(command, CancellationToken.None);

        Assert.Equal(CommandStatus.Completed, recovered.Status);
        Assert.Equal(CommandEvidence.FeedbackConfirmed, recovered.Evidence);
        Assert.Single(transport.Writes, line => line == "!START");
        var audit = Assert.IsType<CommandAuditRecord>(gateway.GetCommand(command.CommandId));
        Assert.Equal(CommandStatus.Completed, audit.Result.Status);
        Assert.Equal(["!START", "#GETENABLE"], audit.TransmittedPayloads);
    }

    [Fact]
    public async Task ReusingCommandIdForDifferentPayloadIsRejected()
    {
        var transport = FakeAsciiTransport.WithDefaultStatus();
        await using var gateway = CreateGateway(transport, CommandsDisabledOptions());
        var session = await ConnectAndWaitAsync(gateway);

        var first = await gateway.SetModeAsync(new("mode-collision", session.SessionId, GatewayContractV1.DummyProfileId, 1), CancellationToken.None);
        var second = await gateway.SetModeAsync(new("mode-collision", session.SessionId, GatewayContractV1.DummyProfileId, 2), CancellationToken.None);

        Assert.Equal(CommandStatus.Unsupported, first.Status);
        Assert.Equal(CommandResultCode.CommandIdConflict, second.Code);
        Assert.Equal(CommandStatus.Rejected, second.Status);
    }

    [Fact]
    public async Task BlockingHomeAndResetStayOutsideProductionCapabilities()
    {
        var transport = FakeAsciiTransport.WithDefaultStatus();
        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await ConnectAndWaitAsync(gateway);

        Assert.DoesNotContain(RobotCommandKind.Home, gateway.Capabilities.SupportedCommands);
        Assert.DoesNotContain(RobotCommandKind.Reset, gateway.Capabilities.SupportedCommands);
        var home = await gateway.HomeAsync(Command("blocked-home", session.SessionId), CancellationToken.None);

        Assert.Equal(CommandStatus.Unsupported, home.Status);
        Assert.Equal(CommandResultCode.CommandsDisabled, home.Code);
        Assert.DoesNotContain("!HOME", transport.Writes);
    }

    [Fact]
    public async Task ManualDisconnectCannotAbandonAnEnabledRobot()
    {
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 1\n")],
            _ => []
        });
        await using var gateway = CreateGateway(transport, SupervisedOptions());
        await ConnectAndWaitAsync(gateway);

        await Assert.ThrowsAsync<GatewayConflictException>(() => gateway.DisconnectAsync(CancellationToken.None));

        Assert.True(transport.IsOpen);
        Assert.Equal(ConnectionState.Connected, gateway.GetSession().ConnectionState);
        await gateway.ShutdownAsync(CancellationToken.None);
    }

    [Fact]
    public async Task ManualDisconnectReleasesWrongPortWithUnknownStaleState()
    {
        var transport = new FakeAsciiTransport((_, _) => []);
        await using var gateway = CreateGateway(transport, SupervisedOptions());
        await gateway.ConnectAsync(
            new("COM4", GatewayContractV1.DummyProfileId),
            CancellationToken.None);
        await TestWait.UntilAsync(() => gateway.GetSession().Validity == Validity.Stale);

        var disconnected = await gateway.DisconnectAsync(CancellationToken.None);

        Assert.Equal(ConnectionState.Offline, disconnected.ConnectionState);
        Assert.False(transport.IsOpen);
        Assert.Equal(1, transport.CloseCount);
    }

    [Fact]
    public async Task ManualDisconnectRejectsAnInFlightHardwareCommandEvenWhenLastFeedbackWasDisabled()
    {
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 0\n")],
            "!START" => [],
            _ => []
        }) { IgnoreReadCancellation = true };
        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await ConnectAndWaitAsync(gateway);
        var commandTask = gateway.EnableAsync(Command("disconnect-pending-enable", session.SessionId), CancellationToken.None);
        await TestWait.UntilAsync(() => transport.Writes.Contains("!START"));

        await Assert.ThrowsAsync<GatewayConflictException>(() => gateway.DisconnectAsync(CancellationToken.None));

        Assert.True(transport.IsOpen);
        Assert.Equal(ConnectionState.Connected, gateway.GetSession().ConnectionState);
        await gateway.ShutdownAsync(CancellationToken.None);
        Assert.Equal(CommandStatus.Cancelled, (await commandTask).Status);
    }

    [Fact]
    public async Task ShutdownClosesTransportToReleaseAnUncancellableReadBeforeDisposal()
    {
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 0\n")],
            "!START" => [],
            _ => []
        }) { IgnoreReadCancellation = true };
        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await ConnectAndWaitAsync(gateway);
        var commandTask = gateway.EnableAsync(Command("shutdown-pending-command", session.SessionId), CancellationToken.None);
        await TestWait.UntilAsync(() => transport.Writes.Contains("!START"));

        var shutdownTask = gateway.ShutdownAsync(CancellationToken.None);

        var command = await commandTask.WaitAsync(TimeSpan.FromSeconds(1));
        var disconnected = await shutdownTask.WaitAsync(TimeSpan.FromSeconds(1));
        Assert.Equal(CommandStatus.Cancelled, command.Status);
        Assert.Equal(ConnectionState.Offline, disconnected.ConnectionState);
        Assert.False(transport.IsOpen);
        Assert.Equal(1, transport.CloseCount);
        Assert.Equal(1, transport.DisposeCount);
    }

    [Fact]
    public async Task JointGroupRequiresCompleteEnvelopeAndStableMeasuredFeedback()
    {
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 1\n")],
            var commandLine when commandLine.StartsWith('>') => [FakeAsciiTransport.Ascii("15\n")],
            _ => []
        });
        await using var gateway = CreateGateway(transport, SupervisedOptions(speedLimit: null));
        var session = await ConnectAndWaitAsync(gateway);

        var noEnvelope = await gateway.SendJointGroupAsync(
            new("move-no-speed-envelope", session.SessionId, GatewayContractV1.DummyProfileId, [0, 0, 0, 0, 0, 0], 10),
            CancellationToken.None);
        Assert.Equal(CommandResultCode.SpeedUnverified, noEnvelope.Code);
        Assert.DoesNotContain(transport.Writes, line => line.StartsWith('>'));

        await gateway.ShutdownAsync(CancellationToken.None);
        var moved = false;
        await using var configuredGateway = CreateGateway(transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii(moved ? "ok 1 2 3 4 5 6\n" : "ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 1\n")],
            var commandLine when commandLine.StartsWith('>') => AcceptMove(),
            _ => []
        }), SupervisedOptions(speedLimit: 20));
        IReadOnlyList<byte[]> AcceptMove()
        {
            moved = true;
            return [FakeAsciiTransport.Ascii("15\n")];
        }
        session = await ConnectAndWaitAsync(configuredGateway);
        var completed = await configuredGateway.SendJointGroupAsync(
            new("move-confirmed", session.SessionId, GatewayContractV1.DummyProfileId, [1, 2, 3, 4, 5, 6], 10),
            CancellationToken.None);

        Assert.Equal(CommandStatus.Completed, completed.Status);
        Assert.Equal(CommandEvidence.FeedbackConfirmed, completed.Evidence);
        Assert.Contains(">1,2,3,4,5,6,10", transport.Writes);
        Assert.True(transport.Writes.Count(line => line == "#GETJPOS") >= 3);
        var completedAudit = Assert.IsType<CommandAuditRecord>(configuredGateway.GetCommand("move-confirmed"));
        Assert.Equal([1d, 2d, 3d, 4d, 5d, 6d], completedAudit.Request.PositionsDeg);
        Assert.Equal(6, completedAudit.Request.PositionsCount);
        Assert.Equal(10, completedAudit.Request.SpeedDegS);
        Assert.False(completedAudit.Request.PayloadTruncated);
        Assert.Equal(">1,2,3,4,5,6,10", completedAudit.TransmittedPayloads[0]);
        Assert.Contains("#GETJPOS", completedAudit.TransmittedPayloads);
        Assert.False(completedAudit.TransmissionLogTruncated);

        var invalid = await configuredGateway.SendJointGroupAsync(
            new("move-invalid-shape", session.SessionId, GatewayContractV1.DummyProfileId, [1, 2, 3, 4, 5, 6, 7, 8], 10),
            CancellationToken.None);
        Assert.Equal(CommandResultCode.InvalidTarget, invalid.Code);
        var invalidAudit = Assert.IsType<CommandAuditRecord>(configuredGateway.GetCommand("move-invalid-shape"));
        Assert.Equal(8, invalidAudit.Request.PositionsCount);
        Assert.Equal([1d, 2d, 3d, 4d, 5d, 6d], invalidAudit.Request.PositionsDeg);
        Assert.True(invalidAudit.Request.PayloadTruncated);
        Assert.Empty(invalidAudit.TransmittedPayloads);
        Assert.False(invalidAudit.TransmissionLogTruncated);
    }

    [Fact]
    public async Task JointGroupCompletionUsesTheFastTelemetryCadence()
    {
        var moved = false;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii(moved ? "ok 1 2 3 4 5 6\n" : "ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 1\n")],
            var commandLine when commandLine.StartsWith('>') => AcceptMove(),
            _ => []
        });
        IReadOnlyList<byte[]> AcceptMove()
        {
            moved = true;
            return [FakeAsciiTransport.Ascii("15\n")];
        }

        var completion = new JointGroupCompletionPolicy(0.1, 100, 500);
        var options = SupervisedOptions(20, completion) with
        {
            JointPollInterval = TimeSpan.FromMilliseconds(25),
            PollInterval = TimeSpan.FromMilliseconds(500)
        };
        await using var gateway = CreateGateway(transport, options);
        var session = await ConnectAndWaitAsync(gateway);

        var result = await gateway.SendJointGroupAsync(
            new("move-fast-feedback", session.SessionId, GatewayContractV1.DummyProfileId, [1, 2, 3, 4, 5, 6], 10),
            CancellationToken.None);

        Assert.Equal(CommandStatus.Completed, result.Status);
        Assert.Equal(CommandEvidence.FeedbackConfirmed, result.Evidence);
        var audit = Assert.IsType<CommandAuditRecord>(gateway.GetCommand("move-fast-feedback"));
        Assert.True(audit.TransmittedPayloads.Count(line => line == "#GETJPOS") >= 5);
    }

    [Fact]
    public async Task EngineeringJointGroupWritesAndAllowsReplacementWithoutAnyDeviceResponse()
    {
        var diagnostics = new RecordingGatewayDiagnostics();
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 1\n")],
            var direct when direct.StartsWith('>') => [],
            _ => []
        });
        await using var gateway = CreateGateway(transport, EngineeringOptions(), diagnostics: diagnostics);
        var session = await ConnectAndWaitAsync(gateway);

        var result = await gateway.SendDirectAsync(
            new("direct-joint-1", session.SessionId, GatewayContractV1.DummyProfileId, ">1,2,3,4,5,6,10"),
            CancellationToken.None);
        var replacement = await gateway.SendDirectAsync(
            new("direct-joint-2", session.SessionId, GatewayContractV1.DummyProfileId, ">2,3,4,5,6,7,10"),
            CancellationToken.None);

        Assert.Equal(GatewayCommandPolicy.Engineering, gateway.Capabilities.CommandPolicy);
        Assert.True(gateway.Capabilities.DirectCommand);
        Assert.DoesNotContain(RobotCommandKind.JointGroup, gateway.Capabilities.SupportedCommands);
        Assert.Equal(DirectCommandStatus.Queued, result.Status);
        Assert.Equal(CommandEvidence.GatewayAccepted, result.Evidence);
        Assert.Equal(DirectCommandStatus.Queued, replacement.Status);
        Assert.Equal(CommandEvidence.GatewayAccepted, replacement.Evidence);
        await WaitForDirectStatusAsync(gateway, result.RequestId, DirectCommandStatus.Sent);
        await WaitForDirectStatusAsync(gateway, replacement.RequestId, DirectCommandStatus.Sent);
        Assert.Equal(2, transport.Writes.Count(line => line.StartsWith('>')));
        Assert.Contains(">1,2,3,4,5,6,10", transport.Writes);
        Assert.Equal(2, diagnostics.Events.Count(item => item.EventName == "engineering.motion.transport_written"));
    }

    [Fact]
    public async Task EngineeringJointGroupTreatsLateQueueAndAckAsObservationsOnly()
    {
        var diagnostics = new RecordingGatewayDiagnostics();
        var moveSent = false;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" when moveSent => ObserveLateResponses(),
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 1 SEQ_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 1\n")],
            var commandLine when commandLine.StartsWith('>') => BeginMove(),
            _ => []
        });
        IReadOnlyList<byte[]> BeginMove()
        {
            moveSent = true;
            return [];
        }
        IReadOnlyList<byte[]> ObserveLateResponses()
        {
            moveSent = false;
            return [
                FakeAsciiTransport.Ascii("15\n"),
                FakeAsciiTransport.Ascii("ok\n"),
                FakeAsciiTransport.Ascii("ok 1 2 3 4 5 6\n")
            ];
        }
        await using var gateway = CreateGateway(transport, EngineeringOptions(), diagnostics: diagnostics);
        var session = await ConnectAndWaitAsync(gateway);

        var first = await gateway.SendDirectAsync(
            new("sequential-move-1", session.SessionId, GatewayContractV1.DummyProfileId, ">1,2,3,4,5,6,10"),
            CancellationToken.None);
        var second = await gateway.SendDirectAsync(
            new("sequential-move-2", session.SessionId, GatewayContractV1.DummyProfileId, ">2,3,4,5,6,7,10"),
            CancellationToken.None);

        Assert.Equal(DirectCommandStatus.Queued, first.Status);
        await TestWait.UntilAsync(() => diagnostics.Events.Count(item => item.EventName == "engineering.motion.device_response_observed") >= 2);
        Assert.Equal(DirectCommandStatus.Queued, second.Status);
        await WaitForDirectStatusAsync(gateway, second.RequestId, DirectCommandStatus.Sent);
        Assert.Equal(2, transport.Writes.Count(line => line.StartsWith('>')));
        Assert.DoesNotContain(diagnostics.Events, item => item.EventName == "engineering.motion.unconfirmed");
    }

    [Fact]
    public async Task EngineeringMotionObserverDoesNotStealExplicitStopResponse()
    {
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 1 SEQ_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 1\n")],
            "!STOP" => [FakeAsciiTransport.Ascii("Stopped ok\n")],
            var commandLine when commandLine.StartsWith('>') => [],
            _ => []
        });
        var diagnostics = new RecordingGatewayDiagnostics();
        await using var gateway = CreateGateway(transport, EngineeringOptions(), diagnostics: diagnostics);
        var session = await ConnectAndWaitAsync(gateway);

        var move = await gateway.SendDirectAsync(
            new("move-before-stop", session.SessionId, GatewayContractV1.DummyProfileId, ">1,2,3,4,5,6,10"),
            CancellationToken.None);
        var stop = await gateway.SendDirectAsync(
            new("explicit-stop", session.SessionId, GatewayContractV1.DummyProfileId, "!STOP"),
            CancellationToken.None);

        Assert.Equal(DirectCommandStatus.Queued, move.Status);
        Assert.Equal(DirectCommandStatus.Queued, stop.Status);
        await WaitForDirectStatusAsync(gateway, stop.RequestId, DirectCommandStatus.Sent);
        await TestWait.UntilAsync(() => gateway.GetProtocolFrames().Any(
            frame => frame.Raw == "Stopped ok"
                && (frame.CorrelationId is null
                    || !frame.CorrelationId.StartsWith("engineering-manual-", StringComparison.Ordinal))));
    }

    [Fact]
    public async Task EngineeringManualMotionQueryTimeoutsDoNotDisconnectOrBlockTheNextTarget()
    {
        var moveCount = 0;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" when moveCount > 0 => [],
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 3 CONT_TRAJ\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 1\n")],
            var commandLine when commandLine.StartsWith('>') => IncrementMoveCount(),
            _ => []
        });
        IReadOnlyList<byte[]> IncrementMoveCount()
        {
            moveCount++;
            return [];
        }
        var diagnostics = new RecordingGatewayDiagnostics();
        await using var gateway = CreateGateway(transport, EngineeringOptions(), diagnostics: diagnostics);
        var session = await ConnectAndWaitAsync(gateway);
        var jointQueriesBeforeMotion = transport.Writes.Count(line => line == "#GETJPOS");

        var first = await gateway.SendDirectAsync(
            new("missing-queue-1", session.SessionId, GatewayContractV1.DummyProfileId, ">1,2,3,4,5,6,10"),
            CancellationToken.None);
        await TestWait.UntilAsync(
            () => transport.Writes.Count(line => line == "#GETJPOS") >= jointQueriesBeforeMotion + 21,
            TimeSpan.FromSeconds(3));
        var second = await gateway.SendDirectAsync(
            new("missing-queue-2", session.SessionId, GatewayContractV1.DummyProfileId, ">2,3,4,5,6,7,10"),
            CancellationToken.None);

        Assert.Equal(DirectCommandStatus.Queued, first.Status);
        Assert.Equal(ConnectionState.Connected, gateway.GetSession().ConnectionState);
        Assert.Equal(Validity.Stale, gateway.GetSession().Validity);
        Assert.Equal(DirectCommandStatus.Queued, second.Status);
        await WaitForDirectStatusAsync(gateway, second.RequestId, DirectCommandStatus.Sent);
        Assert.Equal(2, transport.Writes.Count(line => line.StartsWith('>')));
        Assert.Equal(2, diagnostics.Events.Count(item => item.EventName == "engineering.motion.query_timeout"));
    }

    [Fact]
    public async Task EngineeringManualMotionMarksContinuingButFrozenFeedbackStaleAndRecoversOnMovement()
    {
        var reportedJointOne = 0d;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii($"ok {reportedJointOne} 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 1\n")],
            var commandLine when commandLine.StartsWith('>') => [],
            _ => []
        });
        var diagnostics = new RecordingGatewayDiagnostics();
        await using var gateway = CreateGateway(
            transport,
            EngineeringOptions() with
            {
                JointPollInterval = TimeSpan.FromMilliseconds(25),
                StatusPollInterval = TimeSpan.FromMilliseconds(500),
                EngineeringFeedbackFreezeWindow = TimeSpan.FromMilliseconds(250)
            },
            diagnostics: diagnostics);
        var session = await ConnectAndWaitAsync(gateway);

        var sent = await gateway.SendDirectAsync(
            new("frozen-feedback-move", session.SessionId, GatewayContractV1.DummyProfileId, ">10,0,0,0,0,0,10"),
            CancellationToken.None);
        await TestWait.UntilAsync(() => diagnostics.Events.Any(
            item => item.EventName == "engineering.motion.feedback_frozen_suspected"));

        Assert.Equal(DirectCommandStatus.Queued, sent.Status);
        Assert.Equal(Validity.Stale, gateway.GetJointState().Validity);
        var frozenFrame = Assert.Single(gateway.GetProtocolFrames(100), frame => frame.ParsedKind == "feedbackFrozen");
        Assert.Equal(ProtocolDirection.Error, frozenFrame.Direction);
        Assert.StartsWith($"engineering-manual-{session.SessionId}", frozenFrame.CorrelationId);
        Assert.Contains("RequestId=frozen-feedback-move", frozenFrame.Raw);

        var replacement = await gateway.SendDirectAsync(
            new("replacement-while-frozen", session.SessionId, GatewayContractV1.DummyProfileId, ">20,0,0,0,0,0,10"),
            CancellationToken.None);
        await TestWait.UntilAsync(() => transport.Writes.Count(line => line == "#GETJPOS") >= 2);

        Assert.Equal(DirectCommandStatus.Queued, replacement.Status);
        await WaitForDirectStatusAsync(gateway, replacement.RequestId, DirectCommandStatus.Sent);
        Assert.Equal(Validity.Stale, gateway.GetJointState().Validity);
        Assert.Equal(2, transport.Writes.Count(line => line.StartsWith('>')));

        reportedJointOne = 1;
        await TestWait.UntilAsync(() => gateway.GetJointState().Validity == Validity.Valid);

        Assert.Contains(
            diagnostics.Events,
            item => item.EventName == "engineering.motion.feedback_progress_resumed");
        Assert.Equal(1, gateway.GetJointState().PositionsDeg[0]);
        Assert.Equal(ConnectionState.Connected, gateway.GetSession().ConnectionState);
    }

    [Fact]
    public void EngineeringFeedbackFreezeWindowRejectsUnboundedConfiguration()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => (EngineeringOptions() with
        {
            EngineeringFeedbackFreezeWindow = TimeSpan.FromMilliseconds(249)
        }).Validate());
        Assert.Throws<ArgumentOutOfRangeException>(() => (EngineeringOptions() with
        {
            EngineeringFeedbackFreezeWindow = TimeSpan.FromMilliseconds(5_001)
        }).Validate());
    }

    [Fact]
    public async Task StopAndDisableEndsEngineeringManualMotionAndAllowsAConfirmedRestart()
    {
        var enabled = true;
        var moveCount = 0;
        var diagnostics = new RecordingGatewayDiagnostics();
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 1 SEQ_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii(enabled ? "ok 1\n" : "ok 0\n")],
            "!START" => Enable(),
            "!STOP" => [FakeAsciiTransport.Ascii("Stopped ok\n")],
            DummyAsciiProtocol.SafetyZeroCurrentLine => [],
            "!DISABLE" => Disable(),
            var commandLine when commandLine.StartsWith('>') => IncrementMoveCount(),
            _ => []
        });
        IReadOnlyList<byte[]> Enable()
        {
            enabled = true;
            return [FakeAsciiTransport.Ascii("Started ok\n")];
        }
        IReadOnlyList<byte[]> Disable()
        {
            enabled = false;
            return [FakeAsciiTransport.Ascii("Disabled ok\n")];
        }
        IReadOnlyList<byte[]> IncrementMoveCount()
        {
            moveCount++;
            return [];
        }

        await using var gateway = CreateGateway(transport, EngineeringOptions(), diagnostics: diagnostics);
        var session = await ConnectAndWaitAsync(gateway);
        var firstMove = await gateway.SendDirectAsync(
            new("queued-without-final-ack", session.SessionId, GatewayContractV1.DummyProfileId, ">1,2,3,4,5,6,10"),
            CancellationToken.None);
        var stop = await gateway.StopAndDisableAsync(
            Command("recover-motion", session.SessionId),
            CancellationToken.None);
        await TestWait.UntilAsync(() => gateway.GetSession().Validity == Validity.Valid);
        var enable = await gateway.EnableAsync(
            Command("enable-after-recovery", session.SessionId),
            CancellationToken.None);
        var secondMove = await gateway.SendDirectAsync(
            new("move-after-recovery", session.SessionId, GatewayContractV1.DummyProfileId, ">2,3,4,5,6,7,10"),
            CancellationToken.None);

        Assert.Equal(CommandStatus.Completed, stop.Status);
        Assert.Equal(CommandEvidence.FeedbackConfirmed, stop.Evidence);
        Assert.Equal(DirectCommandStatus.Queued, firstMove.Status);
        Assert.Equal(CommandStatus.Completed, enable.Status);
        Assert.Equal(DirectCommandStatus.Queued, secondMove.Status);
        await WaitForDirectStatusAsync(gateway, secondMove.RequestId, DirectCommandStatus.Sent);
        Assert.Equal(2, transport.Writes.Count(line => line.StartsWith('>')));
    }

    [Fact]
    public async Task StopPreemptsASilentEngineeringCommandAndRestoresAConfirmedDisabledState()
    {
        var enabled = false;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 11 22 33 44 55\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii(enabled ? "ok 1\n" : "ok 0\n")],
            "!START" => EnableWithoutReply(),
            "!STOP" => [FakeAsciiTransport.Ascii("Stopped ok\n")],
            DummyAsciiProtocol.SafetyZeroCurrentLine => [],
            "!DISABLE" => Disable(),
            _ => []
        });
        IReadOnlyList<byte[]> EnableWithoutReply()
        {
            enabled = true;
            return [];
        }
        IReadOnlyList<byte[]> Disable()
        {
            enabled = false;
            return [FakeAsciiTransport.Ascii("Disabled ok\n")];
        }

        await using var gateway = CreateGateway(transport, EngineeringOptions());
        var session = await ConnectAndWaitAsync(gateway);
        var directTask = gateway.SendDirectAsync(
            new("silent-direct-enable", session.SessionId, GatewayContractV1.DummyProfileId, "!START"),
            CancellationToken.None);
        await TestWait.UntilAsync(() => transport.Writes.Contains("!START"));

        var stop = await gateway.StopAndDisableAsync(
            Command("stop-preempts-direct", session.SessionId),
            CancellationToken.None);
        var direct = await directTask.WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(CommandStatus.Completed, stop.Status);
        Assert.Equal(CommandEvidence.FeedbackConfirmed, stop.Evidence);
        Assert.Equal(DirectCommandStatus.Queued, direct.Status);
        await WaitForDirectStatusAsync(gateway, direct.RequestId, DirectCommandStatus.Sent);
        Assert.Equal(MotorState.Disabled, gateway.GetSession().MotorState);
        Assert.Contains("!STOP", transport.Writes);
        Assert.Contains("!DISABLE", transport.Writes);
    }

    [Fact]
    public async Task EngineeringDirectRejectsBlockingAndUntypedCommandsWithoutWriting()
    {
        var transport = FakeAsciiTransport.WithDefaultStatus();
        await using var gateway = CreateGateway(transport, EngineeringOptions());
        var session = await ConnectAndWaitAsync(gateway);
        var writesBefore = transport.Writes.Count;

        var home = await gateway.SendDirectAsync(
            new("direct-home", session.SessionId, GatewayContractV1.DummyProfileId, "!HOME"),
            CancellationToken.None);
        var current = await gateway.SendDirectAsync(
            new("direct-current", session.SessionId, GatewayContractV1.DummyProfileId, "$0,0,0,0,0,0"),
            CancellationToken.None);

        Assert.Equal(DirectCommandStatus.Rejected, home.Status);
        Assert.Equal(DirectCommandStatus.Rejected, current.Status);
        Assert.Equal(writesBefore, transport.Writes.Count);
    }

    [Fact]
    public async Task JointGroupTimeoutLatchesInterlockAndDoesNotClaimCompletion()
    {
        var diagnostics = new RecordingGatewayDiagnostics();
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 1\n")],
            var commandLine when commandLine.StartsWith('>') => [FakeAsciiTransport.Ascii("15\n")],
            _ => []
        });
        var completion = new JointGroupCompletionPolicy(0.1, 100, 500);
        await using var gateway = CreateGateway(
            transport,
            SupervisedOptions(20, completion),
            diagnostics: diagnostics);
        var session = await ConnectAndWaitAsync(gateway);

        var result = await gateway.SendJointGroupAsync(
            new("move-timeout", session.SessionId, GatewayContractV1.DummyProfileId, [1, 0, 0, 0, 0, 0], 10),
            CancellationToken.None);

        Assert.Equal(CommandStatus.TimedOut, result.Status);
        Assert.Equal(CommandResultCode.Timeout, result.Code);
        Assert.Equal(CommandEvidence.DeviceQueued, result.Evidence);
        Assert.Contains("#GETJPOS 样本保持不变", result.Message);
        var frozenFeedback = Assert.Single(
            diagnostics.Events,
            diagnostic => diagnostic.EventName == "motion.feedback.frozen_suspected");
        Assert.Equal(GatewayDiagnosticSeverity.Warning, frozenFeedback.Severity);
        Assert.Contains("CommandId=move-timeout", frozenFeedback.Detail);
        Assert.Contains("physical result remains unknown", frozenFeedback.Detail);
        var blocked = await gateway.SetModeAsync(
            new("blocked-after-motion-timeout", session.SessionId, GatewayContractV1.DummyProfileId, 1),
            CancellationToken.None);
        Assert.Equal(CommandResultCode.SafetyInterlockLatched, blocked.Code);
    }

    [Fact]
    public async Task StopChainPreemptsCommandAndRequiresDisabledReadback()
    {
        var enabled = false;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii(enabled ? "ok 1\n" : "ok 0\n")],
            "!START" => [],
            "!STOP" => [FakeAsciiTransport.Ascii("Stopped ok\n")],
            DummyAsciiProtocol.SafetyZeroCurrentLine => [],
            "!DISABLE" => Disable(),
            _ => []
        });
        IReadOnlyList<byte[]> Disable()
        {
            enabled = false;
            return [FakeAsciiTransport.Ascii("Disabled ok\n")];
        }

        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await ConnectAndWaitAsync(gateway);
        var enableTask = gateway.EnableAsync(Command("enable-pending", session.SessionId), CancellationToken.None);
        await TestWait.UntilAsync(() => transport.Writes.Contains("!START"));

        var stop = await gateway.StopAndDisableAsync(Command("stop-priority", session.SessionId), CancellationToken.None);
        var enable = await enableTask;

        Assert.Equal(CommandStatus.Cancelled, enable.Status);
        Assert.Equal(CommandStatus.Completed, stop.Status);
        Assert.Equal(CommandEvidence.FeedbackConfirmed, stop.Evidence);
        var writes = transport.Writes.ToArray();
        Assert.True(Array.IndexOf(writes, "!STOP") < Array.IndexOf(writes, DummyAsciiProtocol.SafetyZeroCurrentLine));
        Assert.True(Array.IndexOf(writes, DummyAsciiProtocol.SafetyZeroCurrentLine) < Array.IndexOf(writes, "!DISABLE"));
        var audit = Assert.IsType<CommandAuditRecord>(gateway.GetCommand("stop-priority"));
        Assert.Equal(
            ["!STOP", DummyAsciiProtocol.SafetyZeroCurrentLine, "!DISABLE", "#GETENABLE"],
            audit.TransmittedPayloads);
        Assert.False(audit.TransmissionLogTruncated);
    }

    [Fact]
    public async Task StopChainFailsClosedWhenPhysicalZeroCurrentWriteFaultsTheScheduler()
    {
        var enabled = true;
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii(enabled ? "ok 1\n" : "ok 0\n")],
            "!STOP" => [FakeAsciiTransport.Ascii("Stopped ok\n")],
            DummyAsciiProtocol.SafetyZeroCurrentLine => throw new UnauthorizedAccessException("simulated zero-current write failure"),
            "!DISABLE" => Disable(),
            _ => []
        });
        IReadOnlyList<byte[]> Disable()
        {
            enabled = false;
            return [FakeAsciiTransport.Ascii("Disabled ok\n")];
        }

        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await ConnectAndWaitAsync(gateway);
        var stop = await gateway.StopAndDisableAsync(Command("stop-after-zero-failure", session.SessionId), CancellationToken.None);

        Assert.Equal(CommandStatus.Failed, stop.Status);
        Assert.Equal(CommandResultCode.TransportError, stop.Code);
        Assert.Contains("!STOP", transport.Writes);
        Assert.DoesNotContain("!DISABLE", transport.Writes);
    }

    [Fact]
    public async Task StopPreemptsAnUncancellablePollingResponseFenceAndStillWritesSafetyChain()
    {
        var transport = new FakeAsciiTransport((_, _) => [])
        {
            IgnoreReadCancellation = true
        };
        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await gateway.ConnectAsync(
            new("COM4", GatewayContractV1.DummyProfileId),
            CancellationToken.None);
        await TestWait.UntilAsync(() => transport.Writes.Contains("#GETJPOS"));

        var stop = await gateway
            .StopAndDisableAsync(Command("stop-behind-stalled-poll", session.SessionId), CancellationToken.None)
            .WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(CommandStatus.Unconfirmed, stop.Status);
        Assert.Equal(CommandResultCode.DeviceUnconfirmed, stop.Code);
        Assert.Contains("!STOP", transport.Writes);
        Assert.Contains("!DISABLE", transport.Writes);
        Assert.Equal(Validity.Stale, gateway.GetSession().Validity);
    }

    [Fact]
    public async Task StopPreemptsSilentEnableAndCompletesFromDisabledReadback()
    {
        var transport = new FakeAsciiTransport((line, _) => line switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("ok 0 0 0 0 0 0\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 0\n")],
            "!START" => [],
            _ => []
        }) { IgnoreReadCancellation = true };
        await using var gateway = CreateGateway(transport, SupervisedOptions());
        var session = await ConnectAndWaitAsync(gateway);
        var enableTask = gateway.EnableAsync(Command("uncancellable-enable", session.SessionId), CancellationToken.None);
        await TestWait.UntilAsync(() => transport.Writes.Contains("!START"));

        var stop = await gateway.StopAndDisableAsync(Command("bounded-stop", session.SessionId), CancellationToken.None);

        Assert.Equal(CommandStatus.Completed, stop.Status);
        Assert.Equal(CommandResultCode.Ok, stop.Code);
        Assert.Equal(Validity.Valid, gateway.GetSession().Validity);
        Assert.Contains("!STOP", transport.Writes);
        Assert.Contains("!DISABLE", transport.Writes);

        Assert.Equal(CommandStatus.Cancelled, (await enableTask).Status);
        var blocked = await gateway.SetModeAsync(
            new("blocked-after-uncertain-stop", session.SessionId, GatewayContractV1.DummyProfileId, 1),
            CancellationToken.None);
        Assert.Equal(CommandStatus.TimedOut, blocked.Status);
        Assert.Contains("#CMDMODE 1", transport.Writes);
    }

    private static async Task WaitForDirectStatusAsync(
        RobotGateway gateway,
        string requestId,
        DirectCommandStatus status)
    {
        await TestWait.UntilAsync(() => gateway.GetDirectCommandHistory(128)
            .Any(result => result.RequestId == requestId && result.Status == status));
    }

    private static SimpleRobotCommand Command(string commandId, string sessionId) =>
        new(commandId, sessionId, GatewayContractV1.DummyProfileId);

    private static async Task<RobotSessionSnapshot> ConnectAndWaitAsync(RobotGateway gateway)
    {
        await gateway.ConnectAsync(new("COM4", GatewayContractV1.DummyProfileId), CancellationToken.None);
        await TestWait.UntilAsync(() => gateway.GetSession().Validity == Validity.Valid);
        return gateway.GetSession();
    }

    private static RobotGateway CreateGateway(
        FakeAsciiTransport transport,
        RobotGatewayOptions options,
        RecordingGatewayEventSink? events = null,
        RecordingGatewayDiagnostics? diagnostics = null) => new(
            new FakeAsciiTransportFactory(_ => transport),
            new FakeSerialPortCatalog("COM4"),
            events,
            diagnostics ?? new RecordingGatewayDiagnostics(),
            TimeProvider.System,
            options);

    private static RobotGatewayOptions CommandsDisabledOptions() => BaseOptions();

    private static RobotGatewayOptions SupervisedOptions(
        double? speedLimit = 20,
        JointGroupCompletionPolicy? completion = null) => BaseOptions() with
    {
        HardwareCommandsEnabled = true,
        JointGroupSpeedLimitDegS = speedLimit,
        JointGroupCompletion = speedLimit is null
            ? null
            : completion ?? new JointGroupCompletionPolicy(0.25, 100, 1_000)
    };

    private static RobotGatewayOptions EngineeringOptions() => BaseOptions() with
    {
        HardwareCommandsEnabled = true,
        EngineeringCommandsEnabled = true,
        EngineeringJointSpeedMaxDegS = 100
    };

    private static RobotGatewayOptions BaseOptions() => new()
    {
        JointPollInterval = TimeSpan.FromMilliseconds(50),
        StatusPollInterval = TimeSpan.FromMilliseconds(50),
        PollInterval = TimeSpan.FromMilliseconds(50),
        QueryTimeout = TimeSpan.FromMilliseconds(50),
        CommandTimeout = TimeSpan.FromMilliseconds(250),
        ConsecutiveTimeoutLimit = 3,
        ProtocolFrameCapacity = 256,
        EventQueueCapacity = 64,
        ReadBufferBytes = 256,
        CommandHistoryCapacity = 32
    };
}
