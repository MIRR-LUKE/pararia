package jp.pararia.teacherapp.data

import android.content.Context
import androidx.datastore.core.CorruptionException
import androidx.datastore.core.Serializer
import androidx.datastore.core.updateData
import androidx.datastore.dataStore
import jp.pararia.teacherapp.domain.PendingUpload
import jp.pararia.teacherapp.domain.TeacherAuthBundle
import jp.pararia.teacherapp.domain.TeacherPersistentState
import jp.pararia.teacherapp.domain.PendingUploadStore
import jp.pararia.teacherapp.domain.TeacherTokenStore
import kotlinx.coroutines.flow.first
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

private val persistentJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

private object TeacherPersistentStateSerializer : Serializer<TeacherPersistentState> {
    override val defaultValue: TeacherPersistentState = TeacherPersistentState()

    override suspend fun readFrom(input: InputStream): TeacherPersistentState {
        return try {
            persistentJson.decodeFromString(
                deserializer = TeacherPersistentState.serializer(),
                string = input.readBytes().decodeToString()
            )
        } catch (_: SerializationException) {
            defaultValue
        } catch (_: IOException) {
            defaultValue
        } catch (exception: IllegalArgumentException) {
            throw CorruptionException("TeacherPersistentState を復元できません。", exception)
        }
    }

    override suspend fun writeTo(t: TeacherPersistentState, output: OutputStream) {
        output.write(
            persistentJson.encodeToString(
                serializer = TeacherPersistentState.serializer(),
                value = t
            ).encodeToByteArray()
        )
    }
}

private val Context.teacherPersistentStore by dataStore(
    fileName = "teacher-app-state.json",
    serializer = TeacherPersistentStateSerializer,
)

class TeacherPersistentStateStore(
    private val context: Context
) {
    suspend fun readSnapshot(): TeacherPersistentState = context.teacherPersistentStore.data.first()

    suspend fun saveAuthBundle(bundle: TeacherAuthBundle) {
        context.teacherPersistentStore.updateData { current ->
            current.copy(authBundle = bundle)
        }
    }

    suspend fun clearAuthBundle() {
        context.teacherPersistentStore.updateData { current ->
            current.copy(authBundle = null)
        }
    }

    suspend fun loadPendingUploads(): List<PendingUpload> = readSnapshot().pendingUploads

    suspend fun savePendingUpload(item: PendingUpload) {
        context.teacherPersistentStore.updateData { current ->
            val next = current.pendingUploads
                .filterNot { existing -> existing.id == item.id || existing.recordingId == item.recordingId }
                .plus(item)
                .sortedByDescending { pending -> pending.createdAt }
            current.copy(pendingUploads = next)
        }
    }

    suspend fun removePendingUpload(id: String) {
        context.teacherPersistentStore.updateData { current ->
            current.copy(
                pendingUploads = current.pendingUploads.filterNot { it.id == id }
            )
        }
    }
}

class DataStoreTeacherTokenStore(
    private val persistentStateStore: TeacherPersistentStateStore
) : TeacherTokenStore {
    override suspend fun loadAuthBundle(): TeacherAuthBundle? = persistentStateStore.readSnapshot().authBundle

    override suspend fun saveAuthBundle(bundle: TeacherAuthBundle) {
        persistentStateStore.saveAuthBundle(bundle)
    }

    override suspend fun clearAuthBundle() {
        persistentStateStore.clearAuthBundle()
    }
}

class DataStorePendingUploadStore(
    private val persistentStateStore: TeacherPersistentStateStore
) : PendingUploadStore {
    override suspend fun loadItems(): List<PendingUpload> = persistentStateStore.loadPendingUploads()

    override suspend fun save(item: PendingUpload) {
        persistentStateStore.savePendingUpload(item)
    }

    override suspend fun remove(id: String) {
        persistentStateStore.removePendingUpload(id)
    }
}
