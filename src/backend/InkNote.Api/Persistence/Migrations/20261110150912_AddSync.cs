using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InkNote.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ONE sequence numbers every change of every table, so devices can ask "what came after number N?".
            // It must exist before the tables below (the tombstone table uses it as a column default).
            migrationBuilder.Sql("CREATE SEQUENCE sync_seq;");

            // Stamps a row with the next number and the time on every INSERT and UPDATE. A trigger, not application
            // code, so that NO path can forget it: EF saves, bulk updates (ExecuteUpdate), and the updates that a
            // foreign key makes by itself (deleting a notebook sets notes.notebook_id to NULL) all go through it.
            migrationBuilder.Sql(@"
                CREATE FUNCTION sync_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    NEW.sync_seq := nextval('sync_seq');
                    NEW.sync_at := clock_timestamp();
                    RETURN NEW;
                END $$;");

            // Writes a tombstone when a row is deleted ('note' / 'notebook' / 'tag' is passed as the trigger
            // argument), because a deleted row cannot report that it was deleted. The columns sync_seq and
            // sync_at of the tombstone table fill themselves from their defaults.
            migrationBuilder.Sql(@"
                CREATE FUNCTION sync_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF OLD.user_id IS NOT NULL THEN
                        INSERT INTO sync_tombstones (user_id, entity, entity_id) VALUES (OLD.user_id, TG_ARGV[0], OLD.id);
                    END IF;
                    RETURN OLD;
                END $$;");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "sync_at",
                table: "tags",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<long>(
                name: "sync_seq",
                table: "tags",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "sync_at",
                table: "notes",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<long>(
                name: "sync_seq",
                table: "notes",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "sync_at",
                table: "notebooks",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<long>(
                name: "sync_seq",
                table: "notebooks",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "note_revisions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    note_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    content = table.Column<string>(type: "text", nullable: false),
                    note_version = table.Column<int>(type: "integer", nullable: false),
                    reason = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_note_revisions", x => x.id);
                    table.ForeignKey(
                        name: "fk_note_revisions_notes_note_id",
                        column: x => x.note_id,
                        principalTable: "notes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_note_revisions_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sync_operations",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    op_id = table.Column<Guid>(type: "uuid", nullable: false),
                    result = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_sync_operations", x => new { x.user_id, x.op_id });
                    table.ForeignKey(
                        name: "fk_sync_operations_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sync_tombstones",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sync_seq = table.Column<long>(type: "bigint", nullable: false, defaultValueSql: "nextval('sync_seq')"),
                    sync_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "clock_timestamp()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_sync_tombstones", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_tags_user_id_sync_seq",
                table: "tags",
                columns: new[] { "user_id", "sync_seq" });

            migrationBuilder.CreateIndex(
                name: "ix_notes_user_id_sync_seq",
                table: "notes",
                columns: new[] { "user_id", "sync_seq" });

            migrationBuilder.CreateIndex(
                name: "ix_notebooks_user_id_sync_seq",
                table: "notebooks",
                columns: new[] { "user_id", "sync_seq" });

            migrationBuilder.CreateIndex(
                name: "ix_note_revisions_note_id_created_at",
                table: "note_revisions",
                columns: new[] { "note_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_note_revisions_user_id",
                table: "note_revisions",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_sync_tombstones_user_id_sync_seq",
                table: "sync_tombstones",
                columns: new[] { "user_id", "sync_seq" });

            foreach (var (table, entity) in new[] { ("notes", "note"), ("notebooks", "notebook"), ("tags", "tag") })
            {
                migrationBuilder.Sql($"CREATE TRIGGER trg_{table}_sync_stamp BEFORE INSERT OR UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION sync_stamp();");
                migrationBuilder.Sql($"CREATE TRIGGER trg_{table}_sync_tombstone AFTER DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION sync_tombstone('{entity}');");
            }

            // The rows that already exist got sync_seq 0 from the column default. Number them (the trigger
            // does it: any UPDATE will do), oldest first, so a device that starts from scratch receives them all.
            migrationBuilder.Sql("UPDATE notebooks SET id = id;");
            migrationBuilder.Sql("UPDATE tags SET id = id;");
            migrationBuilder.Sql("UPDATE notes SET id = id;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var table in new[] { "notes", "notebooks", "tags" })
            {
                migrationBuilder.Sql($"DROP TRIGGER IF EXISTS trg_{table}_sync_tombstone ON {table};");
                migrationBuilder.Sql($"DROP TRIGGER IF EXISTS trg_{table}_sync_stamp ON {table};");
            }

            migrationBuilder.DropTable(
                name: "note_revisions");

            migrationBuilder.DropTable(
                name: "sync_operations");

            migrationBuilder.DropTable(
                name: "sync_tombstones");

            migrationBuilder.DropIndex(
                name: "ix_tags_user_id_sync_seq",
                table: "tags");

            migrationBuilder.DropIndex(
                name: "ix_notes_user_id_sync_seq",
                table: "notes");

            migrationBuilder.DropIndex(
                name: "ix_notebooks_user_id_sync_seq",
                table: "notebooks");

            migrationBuilder.DropColumn(
                name: "sync_at",
                table: "tags");

            migrationBuilder.DropColumn(
                name: "sync_seq",
                table: "tags");

            migrationBuilder.DropColumn(
                name: "sync_at",
                table: "notes");

            migrationBuilder.DropColumn(
                name: "sync_seq",
                table: "notes");

            migrationBuilder.DropColumn(
                name: "sync_at",
                table: "notebooks");

            migrationBuilder.DropColumn(
                name: "sync_seq",
                table: "notebooks");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS sync_tombstone();");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS sync_stamp();");
            migrationBuilder.Sql("DROP SEQUENCE IF EXISTS sync_seq;");
        }
    }
}
