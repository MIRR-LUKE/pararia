package jp.pararia.teacher.android.domain

import jp.pararia.teacherapp.domain.PendingUpload
import jp.pararia.teacherapp.domain.PendingUploadStore
import jp.pararia.teacherapp.domain.removeMissingFilePendingUploads
import kotlinx.coroutines.test.runTest
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

class PendingUploadCleanupTest {
    @Test
    fun removesMissingLocalFilesAndKeepsRecoverableItems() = runTest {
        val existingFile = Files.createTempFile("pararia-pending", ".m4a").toFile()
        existingFile.writeText("audio")
        val missingFile = existingFile.resolveSibling("missing-${System.nanoTime()}.m4a")
        val recoverable = pendingUpload(id = "keep", recordingId = "rec-keep", filePath = existingFile.absolutePath)
        val stale = pendingUpload(id = "stale", recordingId = "rec-stale", filePath = missingFile.absolutePath)
        val store = FakePendingUploadStore(listOf(recoverable, stale))

        val result = store.removeMissingFilePendingUploads()

        assertEquals(listOf(recoverable), result.pendingUploads)
        assertEquals(listOf(stale), result.removedItems)
        assertEquals(listOf(recoverable), store.loadItems())
    }

    @Test
    fun leavesStoreUntouchedWhenAllFilesStillExist() = runTest {
        val firstFile = Files.createTempFile("pararia-pending-1", ".m4a").toFile()
        val secondFile = Files.createTempFile("pararia-pending-2", ".m4a").toFile()
        firstFile.writeText("audio-1")
        secondFile.writeText("audio-2")
        val first = pendingUpload(id = "first", recordingId = "rec-first", filePath = firstFile.absolutePath)
        val second = pendingUpload(id = "second", recordingId = "rec-second", filePath = secondFile.absolutePath)
        val store = FakePendingUploadStore(listOf(first, second))

        val result = store.removeMissingFilePendingUploads()

        assertEquals(listOf(first, second), result.pendingUploads)
        assertEquals(emptyList(), result.removedItems)
        assertEquals(listOf(first, second), store.loadItems())
    }

    private fun pendingUpload(
        id: String,
        recordingId: String,
        filePath: String,
    ): PendingUpload =
        PendingUpload(
            id = id,
            recordingId = recordingId,
            filePath = filePath,
            createdAt = "2026-04-27T00:00:00Z",
            attemptCount = 1,
        )

    private class FakePendingUploadStore(items: List<PendingUpload>) : PendingUploadStore {
        private var items = items

        override suspend fun loadItems(): List<PendingUpload> = items

        override suspend fun save(item: PendingUpload) {
            items = items.filterNot { it.id == item.id || it.recordingId == item.recordingId }.plus(item)
        }

        override suspend fun remove(id: String) {
            items = items.filterNot { it.id == id }
        }
    }
}
