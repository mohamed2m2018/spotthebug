import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

/**
 * GET /api/user-stats — Returns aggregated session stats for the logged-in user.
 * POST /api/user-stats — Records a completed session (hunt, pair, or solve).
 */

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });

  if (!user) {
    return Response.json({ totalSessions: 0, bugsFound: 0 });
  }

  const [totalSessions, bugsFound] = await Promise.all([
    prisma.trainingSession.count({
      where: { userId: user.id, status: 'completed' },
    }),
    prisma.sessionRound.count({
      where: {
        session: { userId: user.id },
        userIdentifiedBug: true,
      },
    }),
  ]);

  return Response.json({ totalSessions, bugsFound });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });

  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const body = await req.json();
  const { mode, duration, bugsFound, bugDetails } = body as {
    mode: string;        // 'hunt' | 'pair' | 'solve'
    duration: number;    // seconds
    bugsFound?: number;  // for hunt mode
    bugDetails?: Array<{
      bugId: string;
      category: string;
      framework: string;
      identified: boolean;
      hintsUsed?: number;
      timeTaken?: number;
    }>;
  };

  // Create completed training session
  const trainingSession = await prisma.trainingSession.create({
    data: {
      userId: user.id,
      duration: duration || 0,
      status: 'completed',
      completedAt: new Date(),
      feedback: `${mode} session`,
      // Create round details for hunt sessions
      ...(bugDetails && bugDetails.length > 0
        ? {
            roundDetails: {
              create: bugDetails.map((bug, i) => ({
                roundNumber: i + 1,
                bugId: bug.bugId,
                bugCategory: bug.category,
                bugFramework: bug.framework,
                userIdentifiedBug: bug.identified,
                hintsUsed: bug.hintsUsed ?? 0,
                timeTaken: bug.timeTaken ?? 0,
              })),
            },
          }
        : {}),
    },
  });

  return Response.json({ id: trainingSession.id, recorded: true });
}
