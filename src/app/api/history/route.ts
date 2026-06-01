import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('event_id');
    const fileType = searchParams.get('file_type');
    const uploadedBy = searchParams.get('uploaded_by');
    const search = searchParams.get('search');

    const db = await getDb();

    let query = `
      SELECT
        u.id,
        u.event_id,
        e.name AS event_name,
        e.year AS event_year,
        u.filename,
        u.s3_key,
        u.url,
        u.file_type,
        u.original_size,
        u.compressed_size,
        u.uploaded_by,
        u.uploaded_at,
        u.current_version
      FROM uploads u
      JOIN events e ON u.event_id = e.id
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    if (eventId) {
      query += ' AND u.event_id = ?';
      params.push(Number(eventId));
    }
    if (fileType) {
      query += ' AND u.file_type = ?';
      params.push(fileType);
    }
    if (uploadedBy) {
      query += ' AND u.uploaded_by = ?';
      params.push(uploadedBy);
    }
    if (search) {
      query += ' AND u.filename LIKE ?';
      params.push(`%${search}%`);
    }

    query += ' ORDER BY u.uploaded_at DESC';

    const result = db.exec(query, params);

    if (!result.length) {
      return NextResponse.json({ success: true, uploads: [] });
    }

    const [{ columns, values }] = result;
    const uploads = values.map((row) => {
      const raw: Record<string, unknown> = Object.fromEntries(
        columns.map((col, i) => [col, row[i]])
      );

      // Normalize SQLite timestamp: "YYYY-MM-DD HH:MM:SS" → ISO 8601
      const rawDate = raw.uploaded_at as string | undefined;
      const uploadedAt = rawDate ? rawDate.replace(' ', 'T') + '.000Z' : null;

      return {
        id: raw.id,
        event_id: raw.event_id,
        event_name: raw.event_name,
        event_year: raw.event_year,
        filename: raw.filename,
        originalName: raw.filename,   // SQLite has no originalName; use filename
        s3_key: raw.s3_key,
        url: raw.url,
        type: raw.file_type,          // frontend uses upload.type
        original_size: raw.original_size,
        size: raw.original_size,       // frontend uses upload.size
        compressed_size: raw.compressed_size,
        compressedSize: raw.compressed_size, // frontend uses upload.compressedSize
        uploadedBy: raw.uploaded_by,   // frontend uses upload.uploadedBy
        uploaded_by: raw.uploaded_by,
        uploadedAt,                    // frontend uses upload.uploadedAt
        uploaded_at: uploadedAt,
        current_version: raw.current_version,
      };
    });

    return NextResponse.json({ success: true, uploads });
  } catch (error: any) {
    console.error('GET /api/history error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch history' },
      { status: 500 }
    );
  }
}
