import mysql from 'mysql2/promise';
import { Store } from '../src/db.js';

export async function makeStore(): Promise<Store> {
  const testDb = `mush_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
  });
  await conn.query(`CREATE DATABASE \`${testDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();

  const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: testDb,
    connectionLimit: 5,
  });
  const store = new Store(pool);
  await store.init();
  return store;
}