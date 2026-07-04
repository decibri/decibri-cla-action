import { describe, expect, it } from 'vitest';
import { findCoveringCompany } from '../src/companies';
import { companiesWith, makeAuthor, makeCompany, makeQueries } from './helpers';

describe('findCoveringCompany approved list matching', () => {
  it('matches github_username case insensitively', async () => {
    const file = companiesWith(
      makeCompany({ approvedList: [{ type: 'github_username', value: 'Dev-One' }] }),
    );
    const match = await findCoveringCompany(file, makeAuthor({ login: 'dev-one' }), makeQueries());
    expect(match).not.toBeNull();
    expect(match?.criterionType).toBe('github_username');
  });

  it('matches github_id exactly and does not coerce a near miss', async () => {
    const file = companiesWith(
      makeCompany({ approvedList: [{ type: 'github_id', value: 333333 }] }),
    );

    const hit = await findCoveringCompany(file, makeAuthor({ githubId: 333333 }), makeQueries());
    expect(hit?.criterionType).toBe('github_id');

    const miss = await findCoveringCompany(file, makeAuthor({ githubId: 3333330 }), makeQueries());
    expect(miss).toBeNull();
  });

  it('matches github_id when the configured value is a numeric string', async () => {
    const file = companiesWith(
      makeCompany({ approvedList: [{ type: 'github_id', value: '333333' }] }),
    );
    const match = await findCoveringCompany(file, makeAuthor({ githubId: 333333 }), makeQueries());
    expect(match?.criterionType).toBe('github_id');
  });

  it('cannot match email_domain when no email is available, and does not throw', async () => {
    const file = companiesWith(
      makeCompany({ approvedList: [{ type: 'email_domain', value: 'acme.example' }] }),
    );
    // No email configured for this login, so getPublicEmail returns null.
    const queries = makeQueries();
    const match = await findCoveringCompany(file, makeAuthor({ login: 'no-email' }), queries);
    expect(match).toBeNull();
    expect(queries.calls.getPublicEmail).toBe(1);
  });

  it('matches email_domain case insensitively on the domain part only', async () => {
    const file = companiesWith(
      makeCompany({ approvedList: [{ type: 'email_domain', value: 'Acme.Example' }] }),
    );
    const queries = makeQueries({ emails: { dev: 'Dev@ACME.example' } });
    const match = await findCoveringCompany(file, makeAuthor({ login: 'dev' }), queries);
    expect(match?.criterionType).toBe('email_domain');
  });

  it('matches email_domain only on the exact domain, never a lookalike or suffix', async () => {
    // The approved domain is exactly "acme.com". None of these author emails, whose
    // domains merely resemble or extend it, may match.
    const file = companiesWith(
      makeCompany({ approvedList: [{ type: 'email_domain', value: 'acme.com' }] }),
    );
    const lookalikes = {
      'sub-domain': 'dev@acme.com.attacker.com',
      prefixed: 'dev@notacme.com',
      suffixed: 'dev@acme.commmm',
    };
    for (const [login, email] of Object.entries(lookalikes)) {
      const match = await findCoveringCompany(file, makeAuthor({ login }), makeQueries({ emails: { [login]: email } }));
      expect(match, `${email} must not match acme.com`).toBeNull();
    }

    // The exact domain still matches, proving the negatives above are not a false lockout.
    const exact = await findCoveringCompany(
      file,
      makeAuthor({ login: 'dev' }),
      makeQueries({ emails: { dev: 'dev@acme.com' } }),
    );
    expect(exact?.criterionType).toBe('email_domain');
  });

  it('does not match and does not throw when the email is absent or unverified', async () => {
    const file = companiesWith(
      makeCompany({ approvedList: [{ type: 'email_domain', value: 'acme.com' }] }),
    );
    // getPublicEmail returns null for an unknown login (no published/verified email).
    const absent = makeQueries();
    await expect(
      findCoveringCompany(file, makeAuthor({ login: 'no-email' }), absent),
    ).resolves.toBeNull();

    // An explicitly null email is treated the same: no match, no throw.
    const nulled = makeQueries({ emails: { dev: null } });
    await expect(
      findCoveringCompany(file, makeAuthor({ login: 'dev' }), nulled),
    ).resolves.toBeNull();
  });

  it('looks up the public email at most once across criteria', async () => {
    const file = companiesWith(
      makeCompany({
        approvedList: [
          { type: 'email_domain', value: 'one.example' },
          { type: 'email_domain', value: 'two.example' },
        ],
      }),
    );
    const queries = makeQueries({ emails: { dev: 'dev@two.example' } });
    const match = await findCoveringCompany(file, makeAuthor({ login: 'dev' }), queries);
    expect(match?.criterionType).toBe('email_domain');
    expect(queries.calls.getPublicEmail).toBe(1);
  });

  it('ignores companies whose CCLA is inactive', async () => {
    const company = makeCompany({ approvedList: [{ type: 'github_id', value: 42 }] });
    company.ccla.active = false;
    const match = await findCoveringCompany(
      companiesWith(company),
      makeAuthor({ githubId: 42 }),
      makeQueries(),
    );
    expect(match).toBeNull();
  });
});
