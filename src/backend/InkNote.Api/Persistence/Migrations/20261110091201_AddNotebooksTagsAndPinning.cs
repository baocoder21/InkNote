using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InkNote.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNotebooksTagsAndPinning : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_pinned",
                table: "notes",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "notebook_id",
                table: "notes",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "notebooks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    parent_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notebooks", x => x.id);
                    table.ForeignKey(
                        name: "fk_notebooks_notebooks_parent_id",
                        column: x => x.parent_id,
                        principalTable: "notebooks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "tags",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    normalized_name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tags", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "note_tags",
                columns: table => new
                {
                    note_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tag_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_note_tags", x => new { x.note_id, x.tag_id });
                    table.ForeignKey(
                        name: "fk_note_tags_notes_note_id",
                        column: x => x.note_id,
                        principalTable: "notes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_note_tags_tags_tag_id",
                        column: x => x.tag_id,
                        principalTable: "tags",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_notes_notebook_id",
                table: "notes",
                column: "notebook_id");

            migrationBuilder.CreateIndex(
                name: "ix_note_tags_tag_id",
                table: "note_tags",
                column: "tag_id");

            migrationBuilder.CreateIndex(
                name: "ix_notebooks_parent_id",
                table: "notebooks",
                column: "parent_id");

            migrationBuilder.CreateIndex(
                name: "ix_tags_normalized_name",
                table: "tags",
                column: "normalized_name",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "fk_notes_notebooks_notebook_id",
                table: "notes",
                column: "notebook_id",
                principalTable: "notebooks",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_notes_notebooks_notebook_id",
                table: "notes");

            migrationBuilder.DropTable(
                name: "note_tags");

            migrationBuilder.DropTable(
                name: "notebooks");

            migrationBuilder.DropTable(
                name: "tags");

            migrationBuilder.DropIndex(
                name: "ix_notes_notebook_id",
                table: "notes");

            migrationBuilder.DropColumn(
                name: "is_pinned",
                table: "notes");

            migrationBuilder.DropColumn(
                name: "notebook_id",
                table: "notes");
        }
    }
}
