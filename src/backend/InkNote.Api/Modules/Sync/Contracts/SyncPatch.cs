using System.Text.Json;

namespace InkNote.Api.Modules.Sync.Contracts;

/// <summary>
/// Reads the "data" of an upsert: a JSON object holding only the fields that changed. A field that is
/// ABSENT means "leave it as it is", which is different from a field that is null ("clear it"): that is why
/// the data stays a JsonElement until a handler asks for fields one by one.
/// Every getter throws FormatException for a value of the wrong type, which the handlers turn into "rejected".
/// </summary>
public sealed class SyncPatch(JsonElement? data)
{
    private readonly JsonElement _data = data is { ValueKind: JsonValueKind.Object } d
        ? d
        : throw new FormatException("The data of an upsert must be a JSON object.");

    /// <summary>Is the field mentioned at all (even as null)?</summary>
    public bool Has(string name) => _data.TryGetProperty(name, out _);

    public string? GetString(string name) => TryGet(name, out var e) && e.ValueKind != JsonValueKind.Null
        ? e.ValueKind == JsonValueKind.String ? e.GetString() : throw Wrong(name, "a string")
        : null;

    public bool? GetBool(string name) => TryGet(name, out var e) && e.ValueKind != JsonValueKind.Null
        ? e.ValueKind is JsonValueKind.True or JsonValueKind.False ? e.GetBoolean() : throw Wrong(name, "true or false")
        : null;

    public Guid? GetGuid(string name) => TryGet(name, out var e) && e.ValueKind != JsonValueKind.Null
        ? e.ValueKind == JsonValueKind.String && Guid.TryParse(e.GetString(), out var guid) ? guid : throw Wrong(name, "an id")
        : null;

    /// <summary>null when the field is absent; an empty list when it is null or [].</summary>
    public IReadOnlyList<Guid>? GetGuidList(string name)
    {
        if (!TryGet(name, out var e))
        {
            return null;
        }
        if (e.ValueKind == JsonValueKind.Null)
        {
            return [];
        }
        if (e.ValueKind != JsonValueKind.Array)
        {
            throw Wrong(name, "a list of ids");
        }

        return e.EnumerateArray()
            .Select(item => item.ValueKind == JsonValueKind.String && Guid.TryParse(item.GetString(), out var guid)
                ? guid
                : throw Wrong(name, "a list of ids"))
            .Distinct()
            .ToList();
    }

    public TEnum? GetEnum<TEnum>(string name) where TEnum : struct, Enum
    {
        var text = GetString(name);
        if (text is null)
        {
            return null;
        }

        return Enum.TryParse<TEnum>(text, ignoreCase: true, out var value) && Enum.IsDefined(value)
            ? value
            : throw Wrong(name, $"one of {string.Join(", ", Enum.GetNames<TEnum>())}");
    }

    private bool TryGet(string name, out JsonElement element) => _data.TryGetProperty(name, out element);

    private static FormatException Wrong(string name, string expected) => new($"'{name}' must be {expected}.");
}
