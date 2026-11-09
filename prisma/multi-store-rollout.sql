-- One-time rollout of stores, run after `prisma db push` and before the code is
-- deployed. Replace the placeholder with the network administrator's email.

-- Everyone who already has an account chooses their default store from the list.
-- People who register later need an invite link.
UPDATE "User" SET "canPickStore" = true;

UPDATE "User" SET "isNetworkAdmin" = true WHERE "email" = 'NETWORK_ADMIN_EMAIL';
