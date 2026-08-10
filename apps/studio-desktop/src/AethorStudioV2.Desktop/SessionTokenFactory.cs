using System.Security.Cryptography;

namespace AethorStudioV2.Desktop;

public static class SessionTokenFactory
{
    public static string Create()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
