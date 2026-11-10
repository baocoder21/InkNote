using FluentValidation;

namespace InkNote.Api.Modules.Notes.Application;

public static class NoteLimits
{
    public const int TitleMaxLength = 200;
    public const int ContentMaxLength = 500_000;
}

public sealed class CreateNoteRequestValidator : AbstractValidator<CreateNoteRequest>
{
    public CreateNoteRequestValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(NoteLimits.TitleMaxLength);
        RuleFor(x => x.Content).NotNull().MaximumLength(NoteLimits.ContentMaxLength);
    }
}

public static class NoteOrganizationLimits
{
    public const int MaxTagsPerNote = 20;
}

public sealed class UpdateNoteOrganizationRequestValidator : AbstractValidator<UpdateNoteOrganizationRequest>
{
    public UpdateNoteOrganizationRequestValidator()
    {
        RuleFor(x => x.Version).GreaterThanOrEqualTo(1);
        RuleFor(x => x.Status).IsInEnum(); // a number outside the enum would otherwise be stored as-is
        RuleFor(x => x.TagIds).NotNull().Must(ids => ids is null || ids.Count <= NoteOrganizationLimits.MaxTagsPerNote)
            .WithMessage($"A note can have at most {NoteOrganizationLimits.MaxTagsPerNote} tags.");
    }
}

public sealed class UpdateNoteRequestValidator : AbstractValidator<UpdateNoteRequest>
{
    public UpdateNoteRequestValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(NoteLimits.TitleMaxLength);
        RuleFor(x => x.Content).NotNull().MaximumLength(NoteLimits.ContentMaxLength);
        RuleFor(x => x.Version).GreaterThanOrEqualTo(1);
    }
}
