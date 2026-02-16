# Audit System Guide

## Overview

The Cruzonic Fleet Management Platform implements a comprehensive, FMCSA-compliant audit trail system that automatically captures all changes to critical database tables. This system satisfies federal requirements for tamper-resistant record keeping.

## Regulatory Compliance

### FMCSA Requirements

- **49 CFR §395.8(k)**: Records retention and integrity (6 months minimum)
- **49 CFR §395.30(b)**: Complete audit trail of all edits to driver logs
- **FMCSA ELD Technical Specification**: Tamper-evident record keeping

### Key Features

✅ **Automatic Capture** - All changes logged via database triggers
✅ **Immutable** - Append-only, no manual modifications allowed
✅ **Complete History** - Old and new values for every change
✅ **User Tracking** - Who made each change, when, and from where
✅ **Multi-tenant** - Carrier isolation via Row Level Security
✅ **Searchable** - Full-text search and flexible queries
✅ **Retention Policy** - Configurable archival for long-term compliance

---

## Architecture

### Database Schema

#### `audit_log` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `table_name` | text | Name of table that was changed |
| `schema_name` | text | Database schema (default: public) |
| `record_id` | uuid | ID of the record that changed |
| `operation` | text | INSERT, UPDATE, or DELETE |
| `changed_by_user_id` | uuid | Supabase auth.users ID |
| `changed_by_role` | text | User role at time of change |
| `carrier_id` | uuid | Carrier context |
| `changed_at` | timestamptz | Timestamp of change |
| `old_values` | jsonb | Complete record before change (NULL for INSERT) |
| `new_values` | jsonb | Complete record after change (NULL for DELETE) |
| `changed_fields` | text[] | Array of field names that changed (UPDATE only) |
| `ip_address` | inet | Client IP (optional) |
| `user_agent` | text | Browser/app info (optional) |
| `retention_until` | date | Minimum retention date (6 months) |

### Monitored Tables

The following tables have audit triggers enabled:

1. **`eld_events`** - All ELD event records (most critical)
2. **`log_periods`** - Driver log period changes
3. **`drivers`** - Driver identity and status
4. **`vehicles`** - Vehicle registrations
5. **`eld_devices`** - ELD hardware registrations
6. **`certifications`** - Log certifications
7. **`hos_violations`** - HOS rule violations
8. **`unidentified_driver_records`** - Unidentified driving events
9. **`eld_malfunctions`** - Device malfunctions
10. **`carriers`** - Organization changes

---

## Installation

### Step 1: Apply Migration

Run the audit triggers migration in Supabase SQL Editor:

```bash
# File location
infra/supabase/migrations/20240125000000_audit_triggers.sql
```

**Instructions**:
1. Go to: https://supabase.com/dashboard → SQL Editor
2. Click "New query"
3. Copy entire contents of migration file
4. Paste and click "Run"
5. Wait for completion (~10-20 seconds)

### Step 2: Verify Installation

Run the test script:

```bash
cd backend
npx ts-node src/scripts/test-audit-triggers.ts
```

**Expected Output**:
```
✅ INSERT trigger working
✅ UPDATE trigger working
✅ DELETE trigger working
✅ Multiple tables being audited
✅ Audit history queryable
✅ Changed fields tracked correctly
✅ Old/new values captured properly

🎯 FMCSA Compliance Status: READY
```

---

## Usage

### Automatic Logging

All changes to monitored tables are automatically logged. No code changes required!

**Example**: When a driver creates an ELD event:

```typescript
// Application code (unchanged)
const { data, error } = await supabase
  .from('eld_events')
  .insert({
    event_type: 1,
    event_sub_type: 1,
    // ... other fields
  });

// Audit log entry automatically created by trigger:
// - operation: 'INSERT'
// - new_values: { event_type: 1, event_sub_type: 1, ... }
// - old_values: null
// - changed_by_user_id: <current user>
// - changed_at: <timestamp>
```

### Querying Audit Logs

#### Get Complete History for a Record

```sql
-- Using helper function
SELECT * FROM get_audit_history('eld_events', 'uuid-of-event-record');

-- Returns chronological history:
-- changed_at, operation, changed_by_name, changed_fields, old_values, new_values
```

#### Search by Date Range and Table

```sql
-- All changes to eld_events in January 2024
SELECT * FROM search_audit_logs(
  'eld_events',                    -- table name
  '2024-01-01'::timestamptz,       -- start date
  '2024-01-31'::timestamptz,       -- end date
  NULL,                            -- carrier_id (NULL = all)
  NULL                             -- operation (NULL = all)
);
```

#### View Recent Activity

```sql
-- Last 1000 audit entries with user names
SELECT * FROM audit_log_recent
ORDER BY changed_at DESC
LIMIT 100;
```

#### Get Statistics

```sql
-- Activity summary by table and operation (last 30 days)
SELECT * FROM audit_log_stats;

-- Example output:
-- table_name   | operation | total_changes | unique_records | first_change | last_change
-- eld_events   | INSERT    | 153000        | 153000         | 2024-01-15   | 2024-02-15
-- eld_events   | UPDATE    | 234           | 189            | 2024-01-16   | 2024-02-14
-- drivers      | UPDATE    | 45            | 23             | 2024-01-20   | 2024-02-10
```

### TypeScript/JavaScript Queries

#### Get Audit History in Application Code

```typescript
// Get complete change history for an ELD event
const { data: history } = await supabase
  .from('audit_log')
  .select('*')
  .eq('table_name', 'eld_events')
  .eq('record_id', eventId)
  .order('changed_at', { ascending: true });

// Display timeline
history.forEach((entry) => {
  console.log(`${entry.operation} at ${entry.changed_at}`);
  console.log(`By: ${entry.changed_by_user_id}`);

  if (entry.changed_fields) {
    console.log(`Fields changed: ${entry.changed_fields.join(', ')}`);
  }

  // Show before/after for updates
  if (entry.operation === 'UPDATE') {
    entry.changed_fields.forEach((field) => {
      console.log(`  ${field}: ${entry.old_values[field]} → ${entry.new_values[field]}`);
    });
  }
});
```

#### Search Audit Logs

```typescript
// Find all changes by a specific user
const { data: userChanges } = await supabase
  .from('audit_log')
  .select('*')
  .eq('changed_by_user_id', userId)
  .gte('changed_at', '2024-01-01')
  .lte('changed_at', '2024-12-31')
  .order('changed_at', { ascending: false });

// Filter by carrier
const { data: carrierAudits } = await supabase
  .from('audit_log')
  .select('*')
  .eq('carrier_id', carrierId)
  .eq('table_name', 'eld_events')
  .limit(1000);
```

#### Using RPC Functions

```typescript
// Get audit history via RPC
const { data: history } = await supabase.rpc('get_audit_history', {
  p_table_name: 'eld_events',
  p_record_id: eventId,
});

// Search with filters
const { data: results } = await supabase.rpc('search_audit_logs', {
  p_table_name: 'drivers',
  p_start_date: '2024-01-01',
  p_end_date: '2024-12-31',
  p_carrier_id: carrierId,
  p_operation: 'UPDATE',
});
```

---

## Compliance Workflows

### 1. Driver Log Edit Verification

When a driver or fleet manager edits an ELD event:

```typescript
// 1. Get complete edit history
const { data: edits } = await supabase.rpc('get_audit_history', {
  p_table_name: 'eld_events',
  p_record_id: eventId,
});

// 2. Display to inspector/auditor
edits.forEach((edit) => {
  console.log(`\n${edit.operation} by ${edit.changed_by_name} (${edit.changed_by_role})`);
  console.log(`Time: ${edit.changed_at}`);

  if (edit.changed_fields) {
    console.log('Changes:');
    edit.changed_fields.forEach((field) => {
      console.log(`  ${field}:`);
      console.log(`    Before: ${JSON.stringify(edit.old_values[field])}`);
      console.log(`    After:  ${JSON.stringify(edit.new_values[field])}`);
    });
  }
});
```

### 2. Compliance Report Generation

Generate audit report for FMCSA inspection:

```sql
-- All changes to driver logs in last 6 months
SELECT
  al.changed_at,
  al.operation,
  p.full_name as changed_by,
  al.changed_by_role,
  al.changed_fields,
  al.old_values->>'event_type' as old_event_type,
  al.new_values->>'event_type' as new_event_type,
  al.old_values->>'duty_status' as old_duty_status,
  al.new_values->>'duty_status' as new_duty_status
FROM audit_log al
LEFT JOIN profiles p ON p.id = al.changed_by_user_id
WHERE al.table_name = 'eld_events'
  AND al.carrier_id = '<carrier-uuid>'
  AND al.changed_at >= current_date - interval '6 months'
ORDER BY al.changed_at DESC;
```

### 3. Tamper Detection

Identify suspicious patterns:

```sql
-- Find users who made many deletions
SELECT
  changed_by_user_id,
  p.full_name,
  count(*) as deletion_count
FROM audit_log al
LEFT JOIN profiles p ON p.id = al.changed_by_user_id
WHERE al.operation = 'DELETE'
  AND al.table_name = 'eld_events'
  AND al.changed_at >= current_date - interval '30 days'
GROUP BY changed_by_user_id, p.full_name
HAVING count(*) > 10
ORDER BY deletion_count DESC;

-- Find bulk updates (potential data manipulation)
SELECT
  date_trunc('hour', changed_at) as hour,
  changed_by_user_id,
  count(*) as changes_in_hour
FROM audit_log
WHERE operation = 'UPDATE'
  AND table_name = 'eld_events'
GROUP BY hour, changed_by_user_id
HAVING count(*) > 100
ORDER BY changes_in_hour DESC;
```

---

## Archival and Retention

### Retention Policy

- **Minimum**: 6 months (FMCSA requirement)
- **Recommended**: 2-7 years (carrier discretion)
- **Archive location**: S3 Glacier or equivalent cold storage

### Identify Records for Archival

```sql
-- Find audit logs eligible for archival
SELECT * FROM archive_old_audit_logs('2 years');

-- Returns:
-- archived_count: Number of records older than 2 years
-- oldest_archived_date: Oldest record timestamp
```

### Archive Process

1. **Export to Cold Storage**:
   ```bash
   # Example using Supabase CLI + S3
   supabase db dump --table audit_log \
     --where "changed_at < now() - interval '2 years'" \
     > audit_archive_$(date +%Y%m%d).sql

   aws s3 cp audit_archive_*.sql s3://my-bucket/audit-archives/
   ```

2. **Verify Export**:
   - Check file integrity (SHA-256 checksum)
   - Test restore on separate database
   - Document archive manifest

3. **Delete from Live Database**:
   ```sql
   -- ONLY after verified export
   DELETE FROM audit_log
   WHERE changed_at < now() - interval '2 years'
     AND retention_until < current_date;
   ```

4. **Maintain Archive Manifest**:
   ```sql
   CREATE TABLE audit_archive_manifest (
     archive_date date,
     file_path text,
     record_count bigint,
     date_range_start timestamptz,
     date_range_end timestamptz,
     sha256_checksum text
   );
   ```

---

## Security and Access Control

### Row Level Security

Audit logs use RLS to enforce carrier isolation:

```sql
-- Users can only see audit logs for their carrier
CREATE POLICY "audit_log_select_carrier"
  ON public.audit_log FOR SELECT
  USING (
    carrier_id = public.current_user_carrier_id()
    OR public.current_user_role() IN ('admin', 'support')
  );
```

### Immutability

- **No INSERT/UPDATE/DELETE policies** - only triggers can write
- **No manual modifications** - all changes must come from monitored tables
- **Append-only** - historical records never modified

### Best Practices

1. **Never grant direct INSERT/UPDATE/DELETE** on `audit_log` table
2. **Use service role key** only in backend (never in client code)
3. **Monitor unusual patterns** (bulk deletes, off-hours changes)
4. **Regular exports** to immutable storage (S3 Glacier)
5. **Test restore process** quarterly

---

## Performance Considerations

### Index Usage

The migration creates indexes for common queries:

- `idx_audit_log_table_time` - Queries by table and date
- `idx_audit_log_record` - History for specific records
- `idx_audit_log_user` - Changes by user
- `idx_audit_log_carrier` - Multi-tenant filtering
- `idx_audit_log_search` - Full-text search

### JSONB Queries

For efficient JSONB queries on `old_values` and `new_values`:

```sql
-- Use JSONB operators
SELECT * FROM audit_log
WHERE new_values->>'duty_status' = '1'
  AND table_name = 'eld_events';

-- Create GIN index if needed
CREATE INDEX idx_audit_log_new_values_gin ON audit_log USING GIN (new_values);
```

### Partitioning (Optional)

For high-volume systems (>10M audit records):

```sql
-- Partition audit_log by month
CREATE TABLE audit_log_y2024m01 PARTITION OF audit_log
  FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Automate partition creation
CREATE EXTENSION pg_cron;

SELECT cron.schedule(
  'create-audit-partition',
  '0 0 1 * *',  -- First day of each month
  $$ SELECT create_audit_log_partition(date_trunc('month', now() + interval '1 month')) $$
);
```

---

## Troubleshooting

### Audit Logs Not Appearing

**Symptom**: Changes to tables not being logged

**Check**:
1. Verify trigger exists:
   ```sql
   SELECT * FROM pg_trigger
   WHERE tgname LIKE 'trg_audit_%';
   ```

2. Check for trigger errors in logs

3. Verify `audit_log` table exists and is accessible

4. Test trigger manually:
   ```sql
   -- Should create audit entry
   INSERT INTO carriers (/* ... */) VALUES (/* ... */);

   SELECT * FROM audit_log
   WHERE table_name = 'carriers'
   ORDER BY changed_at DESC
   LIMIT 1;
   ```

### Performance Issues

**Symptom**: Slow queries on `audit_log`

**Solutions**:
1. Add indexes for your query patterns
2. Archive old records
3. Enable partitioning
4. Use materialized views for common aggregations

### Missing User Context

**Symptom**: `changed_by_user_id` is NULL

**Cause**: Changes made via service role or backend without user context

**Solution**:
- Ensure backend passes user context when using service role
- Set `app.current_user_id` session variable before operations
- Use connection pooling with per-request context

---

## API Examples

### REST API Endpoint

```typescript
// backend/src/routes/audit.ts
import { Router } from 'express';
import { supabase } from '../config/supabase';

const router = Router();

// Get audit history for a record
router.get('/audit/:table/:recordId', async (req, res) => {
  const { table, recordId } = req.params;

  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('table_name', table)
    .eq('record_id', recordId)
    .order('changed_at', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ history: data });
});

export default router;
```

### React Component

```typescript
// components/AuditHistory.tsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface AuditEntry {
  changed_at: string;
  operation: string;
  changed_by_user_id: string;
  changed_fields: string[];
  old_values: any;
  new_values: any;
}

export function AuditHistory({ tableName, recordId }: { tableName: string; recordId: string }) {
  const [history, setHistory] = useState<AuditEntry[]>([]);

  useEffect(() => {
    async function fetchHistory() {
      const { data } = await supabase
        .from('audit_log')
        .select('*')
        .eq('table_name', tableName)
        .eq('record_id', recordId)
        .order('changed_at', { ascending: false });

      setHistory(data || []);
    }

    fetchHistory();
  }, [tableName, recordId]);

  return (
    <div className="audit-history">
      <h3>Change History</h3>
      {history.map((entry) => (
        <div key={entry.changed_at} className="audit-entry">
          <div className="audit-header">
            <span className="operation">{entry.operation}</span>
            <span className="timestamp">{new Date(entry.changed_at).toLocaleString()}</span>
          </div>
          {entry.changed_fields && (
            <div className="changes">
              {entry.changed_fields.map((field) => (
                <div key={field} className="field-change">
                  <strong>{field}:</strong>
                  <span className="old-value">{JSON.stringify(entry.old_values[field])}</span>
                  <span className="arrow">→</span>
                  <span className="new-value">{JSON.stringify(entry.new_values[field])}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

## Summary

The audit trigger system provides:

✅ **Automated** - No code changes needed
✅ **Comprehensive** - All critical tables monitored
✅ **Compliant** - Meets FMCSA requirements
✅ **Queryable** - Flexible search and reporting
✅ **Secure** - Immutable, multi-tenant isolation
✅ **Performant** - Indexed, partitionable

**FMCSA Compliance**: ✅ **READY**

All changes to ELD events and related records are automatically logged with complete before/after snapshots, user context, and timestamps. The system supports 6+ month retention, tamper-resistant storage, and comprehensive audit trail reporting for regulatory inspections.
