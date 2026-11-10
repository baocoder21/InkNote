using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InkNote.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRefreshTokenPersistence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_persistent",
                table: "refresh_tokens",
                type: "boolean",
                nullable: false,
                // Tokens that exist now were issued before "remember me" and last 30 days: persistent. The default only
                // fills existing rows; the MODEL has no default (a model default would swallow "false": EF treats false as unset).
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "is_persistent",
                table: "refresh_tokens");
        }
    }
}
