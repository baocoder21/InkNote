using System.Text.Json.Serialization;

namespace InkNote.Api.Modules.Notes.Domain;

/// <summary>
/// Where a note stands in a simple workflow (same set as Inkdrop). The converter makes the
/// API speak names ("onHold") instead of numbers, so clients never depend on the enum order.
/// The database stores the name too (see NoteConfiguration), so rows stay readable.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<NoteStatus>))]
public enum NoteStatus
{
    None = 0,
    Active,
    OnHold,
    Completed,
    Dropped,
}
