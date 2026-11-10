using FluentValidation;

namespace InkNote.Api.Modules.Tags.Application;

public static class TagLimits
{
    public const int NameMaxLength = 50;
}

// NotEmpty() also rejects a name made only of spaces.
public sealed class CreateTagRequestValidator : AbstractValidator<CreateTagRequest>
{
    public CreateTagRequestValidator() =>
        RuleFor(x => x.Name).NotEmpty().MaximumLength(TagLimits.NameMaxLength);
}

public sealed class UpdateTagRequestValidator : AbstractValidator<UpdateTagRequest>
{
    public UpdateTagRequestValidator() =>
        RuleFor(x => x.Name).NotEmpty().MaximumLength(TagLimits.NameMaxLength);
}
