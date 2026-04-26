package jp.pararia.teacher.android.data

import jp.pararia.teacherapp.data.VercelBlobMultipartPart
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class TeacherApiClientBlobMultipartTest {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    @Test
    fun blobMultipartPartCanUseRequestedPartNumberWhenResponseOmitsIt() {
        val decoded = json.decodeFromString(
            VercelBlobMultipartPart.serializer(),
            """{"etag":"etag-from-vercel"}""",
        )

        val completedPart = decoded.copy(partNumber = decoded.partNumber ?: 3)

        assertEquals("etag-from-vercel", completedPart.etag)
        assertEquals(3, completedPart.partNumber)
    }

    @Test
    fun blobMultipartPartKeepsReturnedPartNumberWhenPresent() {
        val decoded = json.decodeFromString(
            VercelBlobMultipartPart.serializer(),
            """{"etag":"etag-from-vercel","partNumber":4}""",
        )

        val completedPart = decoded.copy(partNumber = decoded.partNumber ?: 3)

        assertEquals("etag-from-vercel", completedPart.etag)
        assertEquals(4, completedPart.partNumber)
    }
}
