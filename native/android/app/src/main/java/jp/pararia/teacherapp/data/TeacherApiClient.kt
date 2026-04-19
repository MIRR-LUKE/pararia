package jp.pararia.teacherapp.data

import jp.pararia.teacherapp.config.AppConfig
import jp.pararia.teacherapp.domain.TeacherRecordingEnvelope
import jp.pararia.teacherapp.domain.TeacherTokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class TeacherApiException(
    val statusCode: Int,
    override val message: String,
) : IOException(message)

class TeacherApiClient(
    private val config: AppConfig,
    private val tokenStore: TeacherTokenStore,
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    },
) {
    suspend fun <Response> requestJson(
        path: String,
        deserializer: DeserializationStrategy<Response>,
        method: String = "GET",
        body: String? = null,
        requiresAuth: Boolean = true,
    ): Response {
        val bytes = requestBytes(
            path = path,
            method = method,
            requiresAuth = requiresAuth,
            contentType = "application/json",
            writeBody = body?.let { requestBody ->
                { output -> output.write(requestBody.encodeToByteArray()) }
            },
        )
        return json.decodeFromString(deserializer, bytes.decodeToString())
    }

    suspend fun uploadAudio(
        recordingId: String,
        filePath: String,
        durationSeconds: Double?,
    ): TeacherRecordingEnvelope {
        val boundary = "----Pararia${UUID.randomUUID()}"
        val file = File(filePath)

        val bytes = requestBytes(
            path = "/api/teacher/recordings/$recordingId/audio",
            method = "POST",
            requiresAuth = true,
            contentType = "multipart/form-data; boundary=$boundary",
            extraHeaders = mapOf("Idempotency-Key" to recordingId),
            writeBody = { output ->
                output.write("--$boundary\r\n".encodeToByteArray())
                output.write(
                    "Content-Disposition: form-data; name=\"file\"; filename=\"${file.name}\"\r\n".encodeToByteArray()
                )
                output.write("Content-Type: audio/mp4\r\n\r\n".encodeToByteArray())
                file.inputStream().use { input -> input.copyTo(output) }
                output.write("\r\n".encodeToByteArray())

                if (durationSeconds != null) {
                    output.write("--$boundary\r\n".encodeToByteArray())
                    output.write(
                        "Content-Disposition: form-data; name=\"durationSecondsHint\"\r\n\r\n".encodeToByteArray()
                    )
                    output.write(durationSeconds.toString().encodeToByteArray())
                    output.write("\r\n".encodeToByteArray())
                }

                output.write("--$boundary--\r\n".encodeToByteArray())
            },
        )

        return json.decodeFromString(TeacherRecordingEnvelope.serializer(), bytes.decodeToString())
    }

    private suspend fun requestBytes(
        path: String,
        method: String,
        requiresAuth: Boolean,
        contentType: String,
        extraHeaders: Map<String, String> = emptyMap(),
        writeBody: (suspend (OutputStream) -> Unit)? = null,
    ): ByteArray = withContext(Dispatchers.IO) {
        val connection = openConnection(path)
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("Content-Type", contentType)
            extraHeaders.forEach { (name, value) ->
                connection.setRequestProperty(name, value)
            }

            if (requiresAuth) {
                val bundle = tokenStore.loadAuthBundle()
                    ?: throw TeacherApiException(401, "端末ログインをやり直してください。")
                connection.setRequestProperty("Authorization", "Bearer ${bundle.accessToken}")
            }

            if (writeBody != null) {
                connection.doOutput = true
                connection.outputStream.use { output ->
                    writeBody(output)
                }
            }

            val responseCode = connection.responseCode
            val responseBytes = (if (responseCode in 200..299) connection.inputStream else connection.errorStream)
                ?.use { it.readBytes() }
                ?: ByteArray(0)

            if (responseCode !in 200..299) {
                throw TeacherApiException(
                    statusCode = responseCode,
                    message = parseErrorMessage(responseBytes) ?: "通信に失敗しました。",
                )
            }

            responseBytes
        } finally {
            connection.disconnect()
        }
    }

    private fun parseErrorMessage(bytes: ByteArray): String? {
        if (bytes.isEmpty()) return null
        return runCatching {
            val payload = json.decodeFromString<JsonObject>(bytes.decodeToString())
            payload["error"]?.jsonPrimitive?.content
        }.getOrNull()
    }

    private fun openConnection(path: String): HttpURLConnection {
        val trimmedBase = config.baseUrl.trimEnd('/')
        val trimmedPath = path.trimStart('/')
        val url = URL("$trimmedBase/$trimmedPath")
        return (url.openConnection() as HttpURLConnection)
    }
}
