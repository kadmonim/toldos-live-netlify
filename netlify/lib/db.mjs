// The database: Postgres. Netlify's own database (Netlify Database) when nothing is set; your own
// Neon database instead when TREE_DATABASE_URL is set in Netlify's environment variables.
// `sql` is a tagged template: sql`SELECT … WHERE id = ${id}` resolves to the rows.
import { getDatabase } from '@netlify/database';

const url = process.env.TREE_DATABASE_URL;
export const { sql } = getDatabase(url ? { connectionString: url } : undefined);
