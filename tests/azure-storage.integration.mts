import assert from "node:assert/strict"
import test from "node:test"
import { azureStorage, azureWorkspaceBlob } from "../lib/server/azure-storage.ts"
import { azureBlockId } from "../lib/azure-workspace.ts"

test("Azure SDK stages and commits private files, detects concurrent edits and round trips bytes", { skip: !process.env.AZURE_STORAGE_TEST_CONNECTION_STRING }, async t => {
  const previous = process.env.storage_azure, previousContainer = process.env.storage_azure_container
  process.env.storage_azure = process.env.AZURE_STORAGE_TEST_CONNECTION_STRING
  process.env.storage_azure_container = `test-${crypto.randomUUID()}`
  t.after(() => {
    if (previous === undefined) delete process.env.storage_azure; else process.env.storage_azure = previous
    if (previousContainer === undefined) delete process.env.storage_azure_container; else process.env.storage_azure_container = previousContainer
  })
  const { service, container } = azureStorage()
  // This integration test is exclusively for the local Azurite emulator.
  assert.match(service.url, /^http:\/\/(127\.0\.0\.1|localhost):10000\//)
  await service.getAccountInfo()
  await container.createIfNotExists()
  t.after(async () => { await container.deleteIfExists() })
  const blob = azureWorkspaceBlob(container, "test@example.test", crypto.randomUUID(), "manifests/pdf-explanations/demo/test.html")
  const session = crypto.randomUUID(), block1 = azureBlockId(session, 0), block2 = azureBlockId(session, 1)
  await blob.stageBlock(block1, Buffer.from("<html>"), 6)
  await blob.stageBlock(block2, Buffer.from("Steps</html>"), 12)
  const committed = await blob.commitBlockList([block1, block2], { metadata: { contenthash: "1".repeat(64) }, conditions: { ifNoneMatch: "*" } })
  assert.ok(committed.etag)
  assert.equal((await blob.downloadToBuffer()).toString(), "<html>Steps</html>")
  const empty = azureWorkspaceBlob(container, "test@example.test", crypto.randomUUID(), "manifests/empty.txt")
  await empty.commitBlockList([], { conditions: { ifNoneMatch: "*" } })
  assert.equal((await empty.downloadToBuffer()).length, 0)
  assert.equal((await blob.getProperties()).metadata?.contenthash, "1".repeat(64))
  await assert.rejects(blob.commitBlockList([block1, block2], { conditions: { ifMatch: '"old-etag"' } }), (error: unknown) => (error as { statusCode?: number }).statusCode === 412)
  assert.equal((await blob.downloadToBuffer()).toString(), "<html>Steps</html>")
})
