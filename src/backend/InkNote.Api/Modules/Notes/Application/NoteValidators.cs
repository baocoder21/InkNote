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

public sealed class UpdateNoteRequestValidator : AbstractValidator<UpdateNoteRequest>
{
    public UpdateNoteRequestValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(NoteLimits.TitleMaxLength);
        RuleFor(x => x.Content).NotNull().MaximumLength(NoteLimits.ContentMaxLength);
        RuleFor(x => x.Version).GreaterThanOrEqualTo(1);
    }
}
