package expo.modules.azlinqext.ai

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class HttpResult(val status: Int, val body: String)

/** The one place that touches the network, so everything above it can be tested with a fake. */
interface HttpTransport {
    @Throws(IOException::class)
    fun execute(method: String, url: String, headers: Map<String, String>, body: String?, timeoutMs: Int): HttpResult
}

class UrlConnectionTransport : HttpTransport {
    override fun execute(method: String, url: String, headers: Map<String, String>, body: String?, timeoutMs: Int): HttpResult {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.instanceFollowRedirects = false // a redirect could carry the bearer token somewhere else
            connection.useCaches = false
            headers.forEach { (k, v) -> connection.setRequestProperty(k, v) }
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            return HttpResult(status, stream?.use { readLimited(it) } ?: "")
        } finally {
            connection.disconnect()
        }
    }

    private fun readLimited(stream: java.io.InputStream): String {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val n = stream.read(buffer)
            if (n < 0) break
            out.write(buffer, 0, n)
            if (out.size() > MAX_BODY) throw IOException("response too large")
        }
        return out.toString("UTF-8")
    }

    private companion object { const val MAX_BODY = 256 * 1024 }
}
