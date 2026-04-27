package jp.pararia.teacherapp.domain

import java.io.File

data class PendingUploadCleanupResult(
    val pendingUploads: List<PendingUpload>,
    val removedItems: List<PendingUpload>,
)

suspend fun PendingUploadStore.removeMissingFilePendingUploads(): PendingUploadCleanupResult =
    removeMissingFilePendingUploads(loadItems())

suspend fun PendingUploadStore.removeMissingFilePendingUploads(
    items: List<PendingUpload>,
): PendingUploadCleanupResult {
    val removedItems = items.filter { item -> !File(item.filePath).isFile }
    if (removedItems.isEmpty()) {
        return PendingUploadCleanupResult(
            pendingUploads = items,
            removedItems = emptyList(),
        )
    }

    removedItems.forEach { item -> remove(item.id) }
    return PendingUploadCleanupResult(
        pendingUploads = loadItems(),
        removedItems = removedItems,
    )
}
