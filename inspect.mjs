import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const tables = ['profile_data','favorites','diet_records','weight_records','exercise_records'];
for (const t of tables) {
  const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='${t}' ORDER BY ordinal_position`);
  console.log(`\n=== ${t} ===`);
  r.rows.forEach(c => console.log(` ${c.column_name}: ${c.data_type}`));
}
await pool.end();
