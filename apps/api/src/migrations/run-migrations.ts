import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

// Load environment variables
config();

// Validate environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceToken = process.env.SUPABASE_SERVICE_TOKEN;

if (!supabaseUrl || !supabaseServiceToken) {
  console.error('Missing required environment variables');
  process.exit(1);
}

// Define migration files in order
const migrationFiles = [
  '001_initial_schema.sql',
  '002_function_implementations.sql',
  '003_remaining_functions.sql',
  '004_missing_functions.sql',
  '005_link_management_tables.sql',
  '006_wayback_cache.sql',
  '007_url_embeddings.sql',
  '008_extract_auth.sql'
];

async function executeStatement(statement: string): Promise<void> {
  try {
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Authorization', `Bearer ${supabaseServiceToken!}`);
    headers.append('apikey', supabaseServiceToken!);

    const response = await fetch(`${supabaseUrl!}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sql_query: statement
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`SQL execution failed: ${JSON.stringify(error)}`);
    }
  } catch (error) {
    console.error('Failed to execute statement:', statement);
    throw error;
  }
}

async function runMigrations() {
  console.log('Starting migrations...');

  for (const migrationFile of migrationFiles) {
    console.log(`Running migration: ${migrationFile}`);
    try {
      // Read migration file
      const sql = readFileSync(join(__dirname, 'sql', migrationFile), 'utf8');
      
      // Split the SQL into individual statements (split on semicolons but ignore those in function bodies)
      const statements = sql.split(/;\s*(?=(?:[^']*'[^']*')*[^']*$)/).filter(stmt => stmt.trim());

      // Execute each statement
      for (const statement of statements) {
        if (statement.trim()) {
          await executeStatement(statement);
        }
      }

      console.log(`Successfully ran migration: ${migrationFile}`);
    } catch (error) {
      console.error(`Error running migration ${migrationFile}:`, error);
      process.exit(1);
    }
  }

  console.log('All migrations completed successfully!');
}

// Run migrations
runMigrations().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
}); 