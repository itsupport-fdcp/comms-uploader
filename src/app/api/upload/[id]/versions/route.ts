import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const uploadId = Number(params.id);
    if (!uploadId) {
      return NextResponse.json(
        { success: false, error: 'Invalid upload ID' },
        { status: 400 }
      );
    }

    const db = await getDb();

    const result = db.exec(
      `SELECT id, upload_id, version_number, filename, s3_key, url, uploaded_by, uploaded_at
       FROM upload_versions
       WHERE upload_id = ?
       ORDER BY version_number DESC`,
      [uploadId]
    );

    if (!result.length) {
      return NextResponse.json({ success: true, versions: [] });
    }

    const [{ columns, values }] = result;
    const versions = values.map((row) =>
      Object.fromEntries(columns.map((col, i) => [col, row[i]]))
    );

    return NextResponse.json({ success: true, versions });
  } catch (error: any) {
    console.error('GET /api/upload/[id]/versions error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch versions' },
      { status: 500 }
    );
  }
}
