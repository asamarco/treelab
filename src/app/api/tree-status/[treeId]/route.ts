import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { TreeModel } from '@/lib/models';
import { TreeFile } from '@/lib/types';

export async function GET(request: NextRequest, context: { params: any }) {
  const { treeId } = await context.params;

  if (!treeId) {
    return NextResponse.json(
      { message: 'Tree ID is required' },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();

    const tree = (await TreeModel.findById(treeId)
      .select('updatedAt')
      .lean()
      .exec()) as Pick<TreeFile, 'updatedAt'> | null;

    if (!tree) {
      return NextResponse.json(
        { message: 'Tree not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ updatedAt: tree.updatedAt }, { status: 200 });
  } catch (error) {
    console.error('Failed to get tree status:', error);
    return NextResponse.json(
      { message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
