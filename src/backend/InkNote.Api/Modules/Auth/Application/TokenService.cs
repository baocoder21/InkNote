using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using InkNote.Api.Common;
using InkNote.Api.Modules.Auth.Domain;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace InkNote.Api.Modules.Auth.Application;

/// <summary>Creates access tokens (signed JWTs) and refresh tokens (random strings), and hashes the latter.</summary>
public sealed class TokenService(IOptions<JwtOptions> options)
{
    /// <summary>
    /// A JWT has three parts: a header, a payload of "claims" (who, until when) and a signature made
    /// with our secret key. Anyone can READ the payload; nobody can change it without breaking the
    /// signature, which the API checks on every request. So never put secrets in it.
    /// </summary>
    public (string Token, int ExpiresInSeconds) CreateAccessToken(AppUser user, DateTimeOffset now)
    {
        var jwt = options.Value;
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = jwt.Issuer,
            Audience = jwt.Audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = (now + jwt.AccessTokenLifetime).UtcDateTime,
            Subject = new ClaimsIdentity(
            [
                new Claim(HttpCurrentUser.SubjectClaim, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            ]),
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(jwt.KeyBytes), SecurityAlgorithms.HmacSha256),
        };

        return (new JsonWebTokenHandler().CreateToken(descriptor), (int)jwt.AccessTokenLifetime.TotalSeconds);
    }

    /// <summary>256 random bits from the operating system's secure random generator, as a URL-safe string.</summary>
    public static string NewRefreshToken() => Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));

    /// <summary>
    /// SHA-256 is enough here (no slow password hash needed): the input is 256 random bits, so it
    /// cannot be guessed, and a fast hash lets us look the token up by its hash.
    /// </summary>
    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
