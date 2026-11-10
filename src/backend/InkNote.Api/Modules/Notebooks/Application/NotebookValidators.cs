using FluentValidation;

namespace InkNote.Api.Modules.Notebooks.Application;

public static class NotebookLimits
{
    public const int NameMaxLength = 100;
}

public sealed class CreateNotebookRequestValidator : AbstractValidator<CreateNotebookRequest>
{
    public CreateNotebookRequestValidator() =>
        RuleFor(x => x.Name).NotEmpty().MaximumLength(NotebookLimits.NameMaxLength);
}

public sealed class UpdateNotebookRequestValidator : AbstractValidator<UpdateNotebookRequest>
{
    public UpdateNotebookRequestValidator() =>
        RuleFor(x => x.Name).NotEmpty().MaximumLength(NotebookLimits.NameMaxLength);
}
