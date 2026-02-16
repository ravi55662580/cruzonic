# ⚠️ MIGRATION INSTRUCTIONS - READ THIS FIRST

## Current Status
✅ Migration files exist and are ready
❌ No tables exist in database yet
❌ You tried to run Migration 3 first (wrong order)

## Correct Order (MUST follow exactly)

### 🔴 Migration 1: Core Schema (DO THIS FIRST)

**File**: `infra/supabase/migrations/20240110000000_complete_core_schema.sql`
**Size**: 71 KB
**Duration**: 10-20 seconds

**Steps**:
1. Go to: https://supabase.com/dashboard/project/wttcmwvyhjanmjjdvxxv/sql
2. Click: **"New query"**
3. Open file in code editor: `infra/supabase/migrations/20240110000000_complete_core_schema.sql`
4. Select ALL text (Cmd+A or Ctrl+A)
5. Copy (Cmd+C or Ctrl+C)
6. Paste into Supabase SQL Editor
7. Click: **"Run"** (bottom right corner)
8. Wait for green checkmark ✅

**Verify**:
Run this in SQL Editor:
```sql
SELECT count(*) FROM carriers;
SELECT count(*) FROM profiles;
SELECT count(*) FROM drivers;
```
Should return: `0` for each (tables exist, no data yet)

---

### 🟡 Migration 2: Constraints & Indexes (DO THIS SECOND)

**File**: `infra/supabase/migrations/20240115000000_add_constraints_indexes.sql`
**Size**: 27 KB
**Duration**: 15-30 seconds

**Steps**:
1. Same as above
2. Open: `20240115000000_add_constraints_indexes.sql`
3. Copy all contents
4. Paste into new SQL Editor query
5. Click: **"Run"**
6. Wait for completion

**Verify**:
```sql
SELECT count(*) FROM pg_indexes WHERE tablename = 'eld_events';
```
Should return: a number > 10 (many indexes created)

---

### 🟢 Migration 3: Partitioning (DO THIS THIRD)

**File**: `infra/supabase/migrations/20240120000000_partition_eld_events.sql`
**Size**: 29 KB
**Duration**: 20-40 seconds

**Steps**:
1. Same as above
2. Open: `20240120000000_partition_eld_events.sql`
3. Copy all contents
4. Paste into new SQL Editor query
5. Click: **"Run"**
6. Wait for completion

**Verify**:
```sql
SELECT * FROM eld_events_partition_info ORDER BY partition_name LIMIT 5;
```
Should return: ~5-10 partitions

---

## After All Migrations Complete

Run this verification script:
```bash
cd backend
npx ts-node src/scripts/verify-setup.ts
```

**Expected output**:
```
✅ Supabase connection successful
✅ eld_events table exists
✅ Partitioned table detected (19 partitions)
✅ Partition management functions available
✅ Ready for load testing!
```

## Then Run Load Test

```bash
# Quick test (10 drivers × 7 days)
# Edit CONFIG in load-test.ts: NUM_DRIVERS=10, NUM_DAYS=7
npx ts-node src/scripts/load-test.ts
```

---

## Troubleshooting

### Error: "relation already exists"
**Cause**: Migration partially ran
**Fix**: Continue to next migration, or drop tables and restart

### Error: "relation does not exist"
**Cause**: Previous migration didn't complete
**Fix**: Run previous migration first

### Error: "permission denied"
**Cause**: Not using service role credentials
**Fix**: Ensure you're logged into the correct Supabase project

---

## Quick Reference

**Migration Files Location**:
```
infra/supabase/migrations/
├── 20240110000000_complete_core_schema.sql     ← Run 1st
├── 20240115000000_add_constraints_indexes.sql  ← Run 2nd
└── 20240120000000_partition_eld_events.sql     ← Run 3rd
```

**Supabase SQL Editor**:
https://supabase.com/dashboard/project/wttcmwvyhjanmjjdvxxv/sql

**Verification Script**:
```bash
npx ts-node src/scripts/verify-setup.ts
```

**Load Test Script**:
```bash
npx ts-node src/scripts/load-test.ts
```

---

**Start with Migration 1 and work your way through!** ✅
