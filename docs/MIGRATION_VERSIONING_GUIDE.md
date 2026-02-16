# Database Migration Versioning Guide

## Overview

This guide documents the database migration strategy for the Cruzonic platform using Supabase (PostgreSQL).

**Migration Tool**: Supabase Migrations (PostgreSQL-based)
**Versioning Format**: Timestamp-based (`YYYYMMDDHHMMSS_description.sql`)
**Location**: `infra/supabase/migrations/`

---

## Migration File Naming Convention

### Format

```
YYYYMMDDHHMMSS_description.sql
```

### Examples

```
20240110000000_complete_core_schema.sql
20240115000000_add_constraints_indexes.sql
20240120000000_partition_eld_events.sql
20240125000000_audit_triggers.sql
20240130000000_query_optimization_indexes.sql
```

### Naming Rules

1. **Timestamp**: Use UTC timestamp in format `YYYYMMDDHHMMSS`
2. **Description**: Snake_case, descriptive, max 50 chars
3. **Extension**: Always `.sql`
4. **Sequential**: Chronological order ensures correct application
5. **Idempotent**: Use `CREATE IF NOT EXISTS`, `DROP IF EXISTS`

---

## Current Migration History

### Applied Migrations

| Version | Date | Description | Status |
|---------|------|-------------|--------|
| `20240110000000` | 2024-01-10 | Complete core schema | ✅ Applied |
| `20240115000000` | 2024-01-15 | Add constraints and indexes | ✅ Applied |
| `20240120000000` | 2024-01-20 | Partition eld_events table | ✅ Applied |
| `20240125000000` | 2024-01-25 | Audit trigger system | ✅ Applied |
| `20240130000000` | 2024-01-30 | Query optimization indexes | ✅ Applied |

### Migration Dependency Graph

```
20240110000000_complete_core_schema.sql
    ↓
20240115000000_add_constraints_indexes.sql
    ↓
20240120000000_partition_eld_events.sql
    ↓
20240125000000_audit_triggers.sql
    ↓
20240130000000_query_optimization_indexes.sql
```

**Order matters!** Migrations must be applied sequentially.

---

## Migration File Structure

### Template

```sql
-- ============================================================
-- Migration: [FILENAME]
-- Description: [BRIEF DESCRIPTION]
-- Date: [DATE]
-- Author: [OPTIONAL]
--
-- Dependencies:
-- - Previous migration: [PREVIOUS_MIGRATION_FILE]
-- - Tables required: [LIST]
--
-- Changes:
-- - Creates: [OBJECTS CREATED]
-- - Modifies: [OBJECTS MODIFIED]
-- - Deletes: [OBJECTS DELETED]
-- ============================================================

-- Check prerequisites (optional)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'carriers') THEN
    RAISE EXCEPTION 'Prerequisites not met: carriers table missing';
  END IF;
END $$;

-- Main migration code
CREATE TABLE IF NOT EXISTS example_table (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_example_name ON example_table(name);

-- Add comments
COMMENT ON TABLE example_table IS
  'Example table description';

COMMENT ON COLUMN example_table.name IS
  'Name field description';

-- Update statistics
ANALYZE example_table;
```

---

## Creating New Migrations

### Step 1: Generate Migration File

```bash
# Create migration file with current timestamp
DATE=$(date -u +%Y%m%d%H%M%S)
DESCRIPTION="add_new_feature"
FILE="infra/supabase/migrations/${DATE}_${DESCRIPTION}.sql"

touch "$FILE"
echo "Created: $FILE"
```

### Step 2: Write Migration SQL

Follow the template above. Key principles:

- **Idempotent**: Can be run multiple times safely
- **Reversible**: Include rollback instructions (comments)
- **Tested**: Test on staging first
- **Documented**: Clear comments explaining changes

### Step 3: Test Locally/Staging

```bash
# Apply to staging
psql "$STAGING_DB_URL" -f "$FILE"

# Verify
psql "$STAGING_DB_URL" -c "SELECT * FROM [new_table] LIMIT 1;"
```

### Step 4: Commit to Version Control

```bash
git add "$FILE"
git commit -m "Migration: $DESCRIPTION"
git push
```

### Step 5: Apply to Production

```bash
# Via Supabase Dashboard
# 1. Go to SQL Editor
# 2. Copy/paste migration file
# 3. Click "Run"

# Or via CLI
supabase db push
```

---

## Migration Best Practices

### DO ✅

1. **Use transactions**:
   ```sql
   BEGIN;
   -- migration code
   COMMIT;
   ```

2. **Check prerequisites**:
   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'required_table') THEN
       RAISE EXCEPTION 'Required table missing';
     END IF;
   END $$;
   ```

3. **Make idempotent**:
   ```sql
   CREATE TABLE IF NOT EXISTS ...
   CREATE INDEX IF NOT EXISTS ...
   DROP INDEX IF EXISTS ...
   ```

4. **Add comments**:
   ```sql
   COMMENT ON TABLE my_table IS 'Description';
   COMMENT ON COLUMN my_table.my_column IS 'Description';
   ```

5. **Update statistics**:
   ```sql
   ANALYZE my_table;
   ```

6. **Test rollback**:
   ```sql
   -- Rollback instructions (as comments):
   -- DROP TABLE IF EXISTS my_table;
   -- DROP INDEX IF EXISTS idx_my_table;
   ```

### DON'T ❌

1. **Don't modify old migrations** - Create new ones
2. **Don't use DROP without IF EXISTS**
3. **Don't skip testing**
4. **Don't apply to production without staging test**
5. **Don't forget to backup first**

---

## Rollback Procedures

### Option 1: Create Rollback Migration

```bash
# Create rollback migration
DATE=$(date -u +%Y%m%d%H%M%S)
ORIGINAL="20240130000000_add_feature"
FILE="infra/supabase/migrations/${DATE}_rollback_${ORIGINAL}.sql"

# Write rollback SQL
cat > "$FILE" << 'EOF'
-- Rollback for 20240130000000_add_feature.sql
DROP TABLE IF EXISTS new_table CASCADE;
DROP INDEX IF EXISTS idx_new_table;
EOF
```

### Option 2: Restore from Backup

```bash
# Restore from Supabase backup
# See: docs/DATABASE_BACKUP_RESTORE.md

# Or restore specific table
pg_restore \
  --dbname="$DB_URL" \
  --table=my_table \
  backup_before_migration.dump
```

---

## Migration Tracking

### Migration Log Table (Optional)

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id serial PRIMARY KEY,
  version varchar(255) NOT NULL UNIQUE,
  description text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text,
  execution_time_ms integer,
  checksum text
);

-- Record migration
INSERT INTO schema_migrations (version, description, applied_by, checksum)
VALUES (
  '20240130000000',
  'Query optimization indexes',
  current_user,
  md5('migration file content')
);
```

### Check Applied Migrations

```sql
SELECT version, description, applied_at
FROM schema_migrations
ORDER BY version DESC;
```

---

## Environment-Specific Migrations

### Development

```bash
# Apply all migrations
for file in infra/supabase/migrations/*.sql; do
  echo "Applying: $file"
  psql "$DEV_DB_URL" -f "$file"
done
```

### Staging

```bash
# Apply single migration (test first)
psql "$STAGING_DB_URL" -f infra/supabase/migrations/20240130000000_new_feature.sql
```

### Production

```bash
# ALWAYS backup first!
pg_dump "$PROD_DB_URL" -Fc -f backup_before_migration_$(date +%Y%m%d).dump

# Apply via Supabase Dashboard (recommended)
# Or via CLI:
supabase db push --project-ref wttcmwvyhjanmjjdvxxv
```

---

## Schema Versioning

### Export Current Schema

```bash
# Full schema
pg_dump "$DB_URL" \
  --schema-only \
  --no-owner \
  --no-acl \
  -f infra/supabase/schema_$(date +%Y%m%d).sql

# Commit to git
git add infra/supabase/schema_$(date +%Y%m%d).sql
git commit -m "Schema snapshot: $(date +%Y-%m-%d)"
```

### Compare Schema Versions

```bash
# Diff between two schema files
diff -u \
  infra/supabase/schema_20240115.sql \
  infra/supabase/schema_20240130.sql \
  > schema_changes.diff
```

---

## CI/CD Integration

### GitHub Actions Workflow

Create `.github/workflows/migrate.yml`:

```yaml
name: Database Migrations

on:
  push:
    branches: [main]
    paths:
      - 'infra/supabase/migrations/**'

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1

      - name: Run migrations on staging
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_STAGING_PROJECT_ID }}
        run: |
          supabase db push --project-ref $SUPABASE_PROJECT_ID

      - name: Verify migrations
        run: |
          # Add verification queries
          echo "SELECT count(*) FROM eld_events;"
```

---

## Data Migrations

### Separate Data Migrations from Schema

**Schema migration** (structure):
```sql
-- 20240130000000_add_column.sql
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS certification_status text;
```

**Data migration** (content):
```sql
-- 20240130000001_populate_certification_status.sql
UPDATE drivers
SET certification_status = 'active'
WHERE certification_status IS NULL;
```

### Large Data Migrations

For migrations affecting millions of rows:

```sql
-- Batch processing
DO $$
DECLARE
  batch_size INTEGER := 10000;
  total_rows INTEGER;
  processed INTEGER := 0;
BEGIN
  SELECT count(*) INTO total_rows FROM eld_events WHERE new_field IS NULL;

  WHILE processed < total_rows LOOP
    UPDATE eld_events
    SET new_field = 'default_value'
    WHERE id IN (
      SELECT id FROM eld_events
      WHERE new_field IS NULL
      LIMIT batch_size
    );

    processed := processed + batch_size;
    RAISE NOTICE 'Processed: %/%', processed, total_rows;

    -- Pause to avoid blocking
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;
```

---

## Migration Checklist

### Before Migration

- [ ] Backup database
- [ ] Test on staging
- [ ] Review rollback plan
- [ ] Notify team (if downtime expected)
- [ ] Schedule maintenance window (if needed)

### During Migration

- [ ] Monitor query performance
- [ ] Watch for lock conflicts
- [ ] Check error logs
- [ ] Verify in real-time

### After Migration

- [ ] Run verification queries
- [ ] Update statistics (ANALYZE)
- [ ] Test application functionality
- [ ] Monitor performance
- [ ] Document results
- [ ] Update migration log

---

## Migration Conflicts

### Resolving Conflicts

If two developers create migrations with same timestamp:

```bash
# Rename conflicting migration
mv 20240130000000_feature_a.sql 20240130000001_feature_a.sql

# Update references in code
git add -A
git commit -m "Resolve migration conflict"
```

---

## Schema Documentation

### Auto-Generate Documentation

```bash
# Generate schema docs
npx ts-node src/scripts/generate-schema-docs.ts

# Output: docs/DATABASE_SCHEMA.md
```

### Keep Documentation Updated

After each migration:

```bash
# Update schema docs
npx ts-node src/scripts/generate-schema-docs.ts

# Commit
git add docs/DATABASE_SCHEMA.md
git commit -m "Update schema documentation"
```

---

## Emergency Procedures

### Failed Migration

1. **Don't panic** - Database is likely in inconsistent state
2. **Check what was applied**:
   ```sql
   SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;
   ```
3. **Rollback transaction** (if still in transaction):
   ```sql
   ROLLBACK;
   ```
4. **Restore from backup** (if committed):
   ```bash
   pg_restore --dbname="$DB_URL" backup_before_migration.dump
   ```

5. **Fix migration file**
6. **Test on staging**
7. **Reapply**

---

## Summary

### Migration Workflow

```
1. Create migration file (timestamp_description.sql)
   ↓
2. Write idempotent SQL
   ↓
3. Test on staging
   ↓
4. Commit to git
   ↓
5. Backup production
   ↓
6. Apply to production
   ↓
7. Verify and monitor
   ↓
8. Update documentation
```

### Quick Commands

```bash
# Create new migration
DATE=$(date -u +%Y%m%d%H%M%S)
touch "infra/supabase/migrations/${DATE}_description.sql"

# Apply migration (staging)
psql "$STAGING_DB_URL" -f "infra/supabase/migrations/[FILE].sql"

# Backup before migration
pg_dump "$PROD_DB_URL" -Fc -f "backup_$(date +%Y%m%d).dump"

# Generate schema docs
npx ts-node src/scripts/generate-schema-docs.ts
```

---

**Migration Status**: ✅ **5 migrations applied**
**Next Migration**: `20240135000000_[your_feature].sql`
**Documentation**: Up to date
