import { NextResponse } from 'next/server';
import { getDb, saveDb } from '@/lib/db';

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

export async function POST(request: Request) {
  try {
    const { name, year } = await request.json();

    if (!name || !year) {
      return NextResponse.json(
        { success: false, error: 'name and year are required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check for duplicate
    const existing = db.exec(
      'SELECT id FROM events WHERE LOWER(name) = LOWER(?) AND year = ?',
      [name.trim(), Number(year)]
    );

    if (existing.length && existing[0].values.length) {
      return NextResponse.json(
        { success: false, error: `Event "${name} ${year}" already exists` },
        { status: 409 }
      );
    }

    db.run(
      'INSERT INTO events (name, year) VALUES (?, ?)',
      [name.trim(), Number(year)]
    );

    const idResult = db.exec('SELECT last_insert_rowid() AS id');
    const newId = idResult[0]?.values[0]?.[0];

    saveDb(db);

    return NextResponse.json({
      success: true,
      event: { id: newId, name: name.trim(), year: Number(year) },
    });
  } catch (error: any) {
    console.error('POST /api/events error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create event' },
      { status: 500 }
    );
  }
}
