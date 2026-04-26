package jp.pararia.teacherapp.data

import jp.pararia.teacherapp.config.AppConfig
import jp.pararia.teacherapp.domain.TeacherRecordingEnvelope
import jp.pararia.teacherapp.domain.TeacherTokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
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

    suspend fun uploadAudioViaBlob(
        recordingId: String,
        filePath: String,
        durationSeconds: Double?,
    ): TeacherRecordingEnvelope {
        val file = File(filePath)
        val contentType = "audio/mp4"
        val tokenResponse = requestJson(
            path = "/api/teacher/recordings/$recordingId/audio/blob-token",
            deserializer = TeacherBlobUploadTokenResponse.serializer(),
            method = "POST",
            body = json.encodeToString(
                TeacherBlobUploadTokenRequest(
                    fileName = file.name,
                    mimeType = contentType,
                    byteSize = file.length(),
                    durationSecondsHint = durationSeconds,
                )
            ),
        )

        val blob = uploadBlobMultipart(
            token = tokenResponse.clientToken,
            apiUrl = tokenResponse.apiUrl,
            apiVersion = tokenResponse.apiVersion,
            pathname = tokenResponse.pathname,
            access = tokenResponse.access,
            contentType = tokenResponse.contentType.ifBlank { contentType },
            file = file,
            partSizeBytes = tokenResponse.partSizeBytes.coerceAtLeast(tokenResponse.minimumPartSizeBytes),
        )

        return requestJson(
            path = "/api/teacher/recordings/$recordingId/audio/blob-complete",
            deserializer = TeacherRecordingEnvelope.serializer(),
            method = "POST",
            body = json.encodeToString(
                TeacherBlobCompleteRequest(
                    fileName = file.name,
                    mimeType = contentType,
                    byteSize = file.length(),
                    durationSecondsHint = durationSeconds,
                    blob = blob,
                )
            ),
        )
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
            connection.connectTimeout = 20_000
            connection.readTimeout = 180_000
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

    private suspend fun uploadBlobMultipart(
        token: String,
        apiUrl: String,
        apiVersion: String,
        pathname: String,
        access: String,
        contentType: String,
        file: File,
        partSizeBytes: Long,
    ): TeacherBlobUploadCompletedBlob = withContext(Dispatchers.IO) {
        val create = requestBlobJson(
            token = token,
            apiUrl = apiUrl,
            apiVersion = apiVersion,
            pathname = pathname,
            access = access,
            contentType = contentType,
            action = "create",
            responseDeserializer = VercelBlobMultipartCreateResponse.serializer(),
        )

        val parts = mutableListOf<VercelBlobMultipartPart>()
        val totalBytes = file.length()
        var offset = 0L
        var partNumber = 1
        while (offset < totalBytes) {
            val length = minOf(partSizeBytes, totalBytes - offset)
            val part = uploadBlobPart(
                token = token,
                apiUrl = apiUrl,
                apiVersion = apiVersion,
                pathname = pathname,
                access = access,
                contentType = contentType,
                uploadId = create.uploadId,
                key = create.key,
                partNumber = partNumber,
                file = file,
                offset = offset,
                length = length,
            )
            parts += part
            offset += length
            partNumber += 1
        }

        requestBlobJson(
            token = token,
            apiUrl = apiUrl,
            apiVersion = apiVersion,
            pathname = pathname,
            access = access,
            contentType = contentType,
            action = "complete",
            uploadId = create.uploadId,
            key = create.key,
            requestBody = json.encodeToString(parts),
            responseDeserializer = TeacherBlobUploadCompletedBlob.serializer(),
        )
    }

    private fun uploadBlobPart(
        token: String,
        apiUrl: String,
        apiVersion: String,
        pathname: String,
        access: String,
        contentType: String,
        uploadId: String,
        key: String,
        partNumber: Int,
        file: File,
        offset: Long,
        length: Long,
    ): VercelBlobMultipartPart {
        val connection = openBlobConnection(apiUrl, pathname)
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 20_000
            connection.readTimeout = 180_000
            applyBlobHeaders(
                connection = connection,
                token = token,
                apiVersion = apiVersion,
                access = access,
                contentType = contentType,
                action = "upload",
                uploadId = uploadId,
                key = key,
                partNumber = partNumber,
            )
            connection.setRequestProperty("x-content-length", length.toString())
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(length)
            connection.outputStream.use { output ->
                RandomAccessFile(file, "r").use { input ->
                    input.seek(offset)
                    copyRange(input, output, length)
                }
            }

            return readBlobResponse(connection, VercelBlobMultipartPart.serializer())
        } finally {
            connection.disconnect()
        }
    }

    private fun <Response> requestBlobJson(
        token: String,
        apiUrl: String,
        apiVersion: String,
        pathname: String,
        access: String,
        contentType: String,
        action: String,
        responseDeserializer: DeserializationStrategy<Response>,
        uploadId: String? = null,
        key: String? = null,
        requestBody: String? = null,
    ): Response {
        val connection = openBlobConnection(apiUrl, pathname)
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 20_000
            connection.readTimeout = 180_000
            applyBlobHeaders(
                connection = connection,
                token = token,
                apiVersion = apiVersion,
                access = access,
                contentType = contentType,
                action = action,
                uploadId = uploadId,
                key = key,
            )
            if (requestBody != null) {
                val bodyBytes = requestBody.encodeToByteArray()
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(bodyBytes.size)
                connection.outputStream.use { output -> output.write(bodyBytes) }
            }
            return readBlobResponse(connection, responseDeserializer)
        } finally {
            connection.disconnect()
        }
    }

    private fun applyBlobHeaders(
        connection: HttpURLConnection,
        token: String,
        apiVersion: String,
        access: String,
        contentType: String,
        action: String,
        uploadId: String? = null,
        key: String? = null,
        partNumber: Int? = null,
    ) {
        val storeId = token.split("_").getOrNull(3).orEmpty()
        val requestId = "$storeId:${System.currentTimeMillis()}:${UUID.randomUUID()}"
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("x-api-version", apiVersion.ifBlank { "12" })
        connection.setRequestProperty("x-api-blob-request-id", requestId)
        connection.setRequestProperty("x-api-blob-request-attempt", "0")
        connection.setRequestProperty("x-vercel-blob-access", access.ifBlank { "private" })
        connection.setRequestProperty("x-content-type", contentType.ifBlank { "audio/mp4" })
        connection.setRequestProperty("x-mpu-action", action)
        if (uploadId != null) {
            connection.setRequestProperty("x-mpu-upload-id", uploadId)
        }
        if (key != null) {
            connection.setRequestProperty("x-mpu-key", urlEncode(key))
        }
        if (partNumber != null) {
            connection.setRequestProperty("x-mpu-part-number", partNumber.toString())
        }
    }

    private fun <Response> readBlobResponse(
        connection: HttpURLConnection,
        responseDeserializer: DeserializationStrategy<Response>,
    ): Response {
        val responseCode = connection.responseCode
        val responseBytes = (if (responseCode in 200..299) connection.inputStream else connection.errorStream)
            ?.use { it.readBytes() }
            ?: ByteArray(0)
        if (responseCode !in 200..299) {
            throw TeacherApiException(
                statusCode = responseCode,
                message = parseErrorMessage(responseBytes) ?: "Blob アップロードに失敗しました。",
            )
        }
        return json.decodeFromString(responseDeserializer, responseBytes.decodeToString())
    }

    private fun copyRange(input: RandomAccessFile, output: OutputStream, length: Long) {
        val buffer = ByteArray(256 * 1024)
        var remaining = length
        while (remaining > 0) {
            val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
            if (read < 0) break
            output.write(buffer, 0, read)
            remaining -= read
        }
        if (remaining > 0) {
            throw IOException("音声ファイルを最後まで読めませんでした。")
        }
    }

    private fun openBlobConnection(apiUrl: String, pathname: String): HttpURLConnection {
        val base = apiUrl.trimEnd('/').ifBlank { "https://vercel.com/api/blob" }
        val url = URL("$base/mpu?pathname=${urlEncode(pathname)}")
        return (url.openConnection() as HttpURLConnection)
    }

    private fun urlEncode(value: String): String =
        URLEncoder.encode(value, Charsets.UTF_8.name())
}

@Serializable
private data class TeacherBlobUploadTokenRequest(
    val fileName: String,
    val mimeType: String,
    val byteSize: Long,
    val durationSecondsHint: Double? = null,
)

@Serializable
private data class TeacherBlobUploadTokenResponse(
    val clientToken: String,
    val pathname: String,
    val fileName: String,
    val access: String,
    val contentType: String,
    val apiUrl: String,
    val apiVersion: String,
    val partSizeBytes: Long,
    val minimumPartSizeBytes: Long,
    val maximumSizeInBytes: Long,
)

@Serializable
private data class VercelBlobMultipartCreateResponse(
    val key: String,
    val uploadId: String,
)

@Serializable
private data class VercelBlobMultipartPart(
    val etag: String,
    val partNumber: Int,
)

@Serializable
private data class TeacherBlobUploadCompletedBlob(
    val url: String,
    val downloadUrl: String? = null,
    val pathname: String,
    val contentType: String? = null,
    val size: Long? = null,
)

@Serializable
private data class TeacherBlobCompleteRequest(
    val fileName: String,
    val mimeType: String,
    val byteSize: Long,
    val durationSecondsHint: Double? = null,
    val blob: TeacherBlobUploadCompletedBlob,
)
