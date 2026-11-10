using Microsoft.AspNetCore.Identity;

namespace InkNote.Api.Modules.Auth.Domain;

/// <summary>
/// A person who can sign in. ASP.NET Core Identity provides the base class (email, password
/// HASH, lockout counters...); the Guid key matches the Guid ids used everywhere else.
/// </summary>
public sealed class AppUser : IdentityUser<Guid>
{
    public DateTimeOffset CreatedAt { get; set; }
}
