import { NextResponse } from 'next/server';
import { getDb, saveDb } from '@/lib/db';

export async function POST(
  request: Request,
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

    const { version_number, performed_by } = await request.json();
    if (!version_number) {
      return NextResponse.json(
        { success: false, error: 'version_number is required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const actor = performed_by || 'anonymous';

    // Fetch the target version
    const versionResult = db.exec(
      `SELECT filename, s3_key, url FROM upload_versions
       WHERE upload_id = ? AND version_number = ?`,
      [uploadId, version_number]
    );

    if (!versionResult.length || !versionResult[0].values.length) {
      return NextResponse.json(
        { success: false, error: 'Version not found' },
        { status: 404 }
      );
    }

    const [filename, s3Key, url] = versionResult[0].values[0] as [string, string, string];

    // Update the uploads record to point to this version
    db.run(
      `UPDATE uploads SET filename = ?, s3_key = ?, url = ?, current_version = ? WHERE id = ?`,
      [filename, s3Key, url, version_number, uploadId]
    );

    // Log the restore action
    db.run(
      `INSERT INTO upload_actions (upload_id, action, performed_by) VALUES (?, 'RESTORE_VERSION', ?)`,
      [uploadId, actor]
    );

    saveDb(db);

    return NextResponse.json({
      success: true,
      message: `Restored to version ${version_number}`,
      filename,
      url,
    });
  } catch (error: any) {
    console.error('POST /api/upload/[id]/restore error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to restore version' },
      { status: 500 }
    );
  }
}
