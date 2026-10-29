import { db } from './db';
import { createLogger } from './logger';

const log = createLogger('eligibility');

export type EligibilityContext = 'register' | 'invite' | 'accept-invite' | 'login' | 'session';

export type IneligibleReason = 'restricted_email' | 'restricted_domain' | 'already_member' | 'pending_invite';

export type Eligibility = { ok: true } | { ok: false; reason: IneligibleReason };

// One message for every reason so the UI never reveals which check failed; the real reason is logged.
export const INELIGIBLE_MESSAGE: Record<EligibilityContext, string> = {
  register: 'Unable to create an account with this email. It may be restricted from using this app.',
  invite:
    'Error inviting user. They may already be part of this organization, have a pending invite, or be restricted from joining.',
  'accept-invite': 'Unable to accept this invite. This email may be restricted from joining.',
  login: 'Unable to sign in. This account may be restricted from using this app.',
  session: 'Unable to sign in. This account may be restricted from using this app.',
};

// "a@mail.spam.com" -> ["mail.spam.com", "spam.com"], so banning a domain also bans its subdomains.
function domainCandidates(email: string) {
  const parts = email.slice(email.lastIndexOf('@') + 1).split('.');
  return parts.slice(0, -1).map((_, i) => parts.slice(i).join('.'));
}

async function findRestriction(email: string): Promise<IneligibleReason | null> {
  const hit = await db.restriction.findFirst({
    where: {
      OR: [
        { kind: 'EMAIL', value: email },
        { kind: 'DOMAIN', value: { in: domainCandidates(email) } },
      ],
    },
    select: { kind: true },
  });
  if (!hit) return null;
  return hit.kind === 'EMAIL' ? 'restricted_email' : 'restricted_domain';
}

/**
 * Checks whether an email may register, be invited, or accept an invite.
 * Pass `orgId` for invites to also check membership and pending invites in that org.
 * Being a member of a different org is allowed (users can belong to several).
 */
export async function checkEligibility(
  rawEmail: string,
  context: EligibilityContext,
  orgId?: string,
): Promise<Eligibility> {
  const email = rawEmail.trim().toLowerCase();
  const reason = (await findRestriction(email)) ?? (context === 'invite' && orgId ? await findOrgConflict(email, orgId) : null);
  if (!reason) return { ok: true };
  log.warn('ineligible', { context, reason, domain: email.slice(email.lastIndexOf('@') + 1), orgId });
  return { ok: false, reason };
}

async function findOrgConflict(email: string, orgId: string): Promise<IneligibleReason | null> {
  const member = await db.membership.findFirst({ where: { orgId, user: { email } }, select: { userId: true } });
  if (member) return 'already_member';
  const pending = await db.invite.findFirst({
    where: { orgId, email, acceptedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return pending ? 'pending_invite' : null;
}
