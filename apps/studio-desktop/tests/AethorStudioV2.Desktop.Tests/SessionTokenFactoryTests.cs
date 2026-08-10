using System.Text.RegularExpressions;

namespace AethorStudioV2.Desktop.Tests;

public sealed class SessionTokenFactoryTests
{
    [Fact]
    public void CreateReturnsUniqueBase64UrlTokensWith256BitsOfEntropy()
    {
        var tokens = Enumerable.Range(0, 128).Select(_ => SessionTokenFactory.Create()).ToArray();

        Assert.Equal(tokens.Length, tokens.Distinct(StringComparer.Ordinal).Count());
        Assert.All(tokens, token =>
        {
            Assert.Equal(43, token.Length);
            Assert.Matches(new Regex("^[A-Za-z0-9_-]+$", RegexOptions.CultureInvariant), token);
        });
    }
}
