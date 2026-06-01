import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = await getDb();
    const result = db.exec('SELECT id, name, year, created_at FROM events ORDER BY year DESC, name ASC');

    if (!result.length) {
      return NextResponse.json({ success: true, events: [] });
    }

    const [{ columns, values }] = result;
    const events = values.map((row) =>
      Object.fromEntries(columns.map((col, i) => [col, row[i]]))
    );

    return NextResponse.json({ success: true, events });
  } catch (error: any) {
    console.error('GET /api/events error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch events' },
      { status: 500 }
    );
  }
}
