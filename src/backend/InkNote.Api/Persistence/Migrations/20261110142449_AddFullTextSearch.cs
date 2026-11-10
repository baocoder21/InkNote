using Microsoft.EntityFrameworkCore.Migrations;
using NpgsqlTypes;

#nullable disable

namespace InkNote.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFullTextSearch : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:pg_trgm", ",,")
                .Annotation("Npgsql:PostgresExtension:unaccent", ",,");

            // unaccent() is only STABLE, but a generated column and an index need an IMMUTABLE function.
            // This wrapper promises "same input, same output" (true as long as the unaccent rules file is
            // not changed) and is what the column, the indexes and the queries all call.
            migrationBuilder.Sql(@"
                CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
                LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
                AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;");

            migrationBuilder.AddColumn<NpgsqlTsVector>(
                name: "search_vector",
                table: "notes",
                type: "tsvector",
                nullable: true,
                computedColumnSql: "setweight(to_tsvector('simple', f_unaccent(title)), 'A') || setweight(to_tsvector('simple', f_unaccent(content)), 'B')",
                stored: true);

            migrationBuilder.CreateIndex(
                name: "ix_notes_search_vector",
                table: "notes",
                column: "search_vector")
                .Annotation("Npgsql:IndexMethod", "gin");

            // Typo tolerance: trigram indexes on the same expression the queries use (accents removed,
            // lowercase). EF Core cannot describe expression indexes in the model, so they live only here.
            migrationBuilder.Sql("CREATE INDEX ix_notes_title_trgm ON notes USING gin (f_unaccent(lower(title)) gin_trgm_ops);");
            migrationBuilder.Sql("CREATE INDEX ix_notes_content_trgm ON notes USING gin (f_unaccent(lower(content)) gin_trgm_ops);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_notes_content_trgm;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_notes_title_trgm;");

            migrationBuilder.DropIndex(
                name: "ix_notes_search_vector",
                table: "notes");

            migrationBuilder.DropColumn(
                name: "search_vector",
                table: "notes");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS f_unaccent(text);");

            migrationBuilder.AlterDatabase()
                .OldAnnotation("Npgsql:PostgresExtension:pg_trgm", ",,")
                .OldAnnotation("Npgsql:PostgresExtension:unaccent", ",,");
        }
    }
}
