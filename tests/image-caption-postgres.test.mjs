import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

test("caption SQL scopes reads and writes by owner and cascades scan deletion",
  { skip: !process.env.AZ_PGLITE_MODULE }, async () => {
    const { PGlite } = await import(pathToFileURL(process.env.AZ_PGLITE_MODULE).href);
    const db = new PGlite();
    try {
      await db.exec("CREATE TABLE image_scans (id UUID PRIMARY KEY, owner_id UUID NOT NULL)");
      await db.exec(await readFile("migrations/045_image_scan_verification.sql", "utf8"));
      const migration = await readFile("migrations/046_image_caption_checks.sql", "utf8");
      await db.exec(migration);
      await db.exec(migration);
      const source = await readFile("lib/vision/scans.ts", "utf8");
      const read = source.match(/`\s*(SELECT c\.caption[\s\S]+?)`/)[1];
      const write = source.match(/`\s*(INSERT INTO image_caption_checks[\s\S]+?)`/)[1];
      const scan = "00000000-0000-0000-0000-000000000001";
      const owner = "00000000-0000-0000-0000-000000000002";
      const other = "00000000-0000-0000-0000-000000000003";
      await db.query("INSERT INTO image_scans (id, owner_id) VALUES ($1, $2)", [scan, owner]);
      const evidence = JSON.stringify({ status: "insufficient_evidence", sources: [] });
      assert.equal((await db.query(read, [owner, scan])).rows[0].result, null);
      assert.equal((await db.query(write, [other, scan, "other account", evidence])).rows.length, 0);
      assert.equal((await db.query(write, [owner, scan, "first check", evidence])).rows[0].caption, "first check");
      assert.equal((await db.query(write, [owner, scan, "next check", evidence])).rows[0].caption, "next check");
      assert.equal((await db.query(read, [other, scan])).rows.length, 0);
      assert.equal((await db.query(read, [owner, scan])).rows[0].caption, "next check");
      await db.query("DELETE FROM image_scans WHERE id = $1", [scan]);
      assert.equal((await db.query("SELECT * FROM image_caption_checks")).rows.length, 0);
      assert.equal((await db.query(write, [owner, scan, "deleted", evidence])).rows.length, 0);
    } finally {
      await db.close();
    }
  });
