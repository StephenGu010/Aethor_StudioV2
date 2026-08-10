namespace AethorStudioV2.Desktop;

public sealed class SingleInstanceCoordinator : IDisposable
{
    private const string MutexName = "Local\\AethorStudioV2.Desktop.Singleton";
    private const string ActivationEventName = "Local\\AethorStudioV2.Desktop.Activate";
    private readonly Mutex mutex;
    private readonly EventWaitHandle activationEvent;
    private readonly CancellationTokenSource listenerCancellation = new();
    private Task? listener;

    public SingleInstanceCoordinator()
    {
        mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
        IsPrimary = createdNew;
        activationEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ActivationEventName);
        if (!IsPrimary) activationEvent.Set();
    }

    public bool IsPrimary { get; }

    public void Attach(Form form)
    {
        if (!IsPrimary || listener is not null) return;
        listener = Task.Run(() => Listen(form, listenerCancellation.Token));
    }

    public void Dispose()
    {
        listenerCancellation.Cancel();
        activationEvent.Set();
        try { listener?.Wait(TimeSpan.FromSeconds(1)); } catch { }
        activationEvent.Dispose();
        listenerCancellation.Dispose();
        if (IsPrimary)
        {
            try { mutex.ReleaseMutex(); } catch (ApplicationException) { }
        }
        mutex.Dispose();
    }

    private void Listen(Form form, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            activationEvent.WaitOne(TimeSpan.FromMilliseconds(500));
            if (cancellationToken.IsCancellationRequested || form.IsDisposed) continue;
            try
            {
                form.BeginInvoke(() =>
                {
                    if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
                    form.Show();
                    form.Activate();
                });
            }
            catch (InvalidOperationException)
            {
                return;
            }
        }
    }
}
