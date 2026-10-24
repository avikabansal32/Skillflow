/**
 * SkillFlow — Signup Processor (C++)
 *
 * Implements the requirement:
 * When a user fills the signup page:
 * 1. Their information is taken in as a <name>.json file:
 *    {
 *      "Name" : "<name>",
 *      "Email": "<email>"
 *    }
 * 2. And stored inside dbs/ as a .bson file (<name>.bson and users.bson).
 * 3. Also updates local database (dbs/users.json) so the user can immediately log in.
 *
 * Usage:
 *   - From name and email:
 *       ./backend/signup "<name>" "<email>" [password]
 *   - From existing JSON file:
 *       ./backend/signup <name>.json
 *   - Read and decode BSON file:
 *       ./backend/signup read-bson dbs/<name>.bson
 *   - HTTP microservice server mode:
 *       ./backend/signup server [port=8082]
 */

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <cctype>
#include <ctime>
#include <sys/stat.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>

class BsonEncoder {
public:
    static void appendInt32(std::vector<uint8_t>& buf, int32_t val) {
        buf.push_back(static_cast<uint8_t>(val & 0xFF));
        buf.push_back(static_cast<uint8_t>((val >> 8) & 0xFF));
        buf.push_back(static_cast<uint8_t>((val >> 16) & 0xFF));
        buf.push_back(static_cast<uint8_t>((val >> 24) & 0xFF));
    }

    static int32_t readInt32(const std::vector<uint8_t>& buf, size_t offset) {
        if (offset + 4 > buf.size()) return 0;
        return static_cast<int32_t>(buf[offset]) |
               (static_cast<int32_t>(buf[offset + 1]) << 8) |
               (static_cast<int32_t>(buf[offset + 2]) << 16) |
               (static_cast<int32_t>(buf[offset + 3]) << 24);
    }

    static void appendBsonString(std::vector<uint8_t>& buf, const std::string& key, const std::string& val) {
        // Element type 0x02 = UTF-8 string
        buf.push_back(0x02);

        // e_name: CString null-terminated
        for (char c : key) {
            buf.push_back(static_cast<uint8_t>(c));
        }
        buf.push_back(0x00);

        // int32 string length (including trailing null byte)
        int32_t strLen = static_cast<int32_t>(val.length() + 1);
        appendInt32(buf, strLen);

        // string bytes + trailing null byte
        for (char c : val) {
            buf.push_back(static_cast<uint8_t>(c));
        }
        buf.push_back(0x00);
    }

    static std::vector<uint8_t> encodeUserDocument(const std::string& name, const std::string& email) {
        std::vector<uint8_t> body;
        appendBsonString(body, "Name", name);
        appendBsonString(body, "Email", email);

        std::vector<uint8_t> document;
        // Total document size = 4 bytes for length prefix + body size + 1 byte trailing 0x00
        int32_t totalLength = static_cast<int32_t>(4 + body.size() + 1);
        appendInt32(document, totalLength);
        document.insert(document.end(), body.begin(), body.end());
        document.push_back(0x00); // Document terminator

        return document;
    }

    static bool decodeBsonDocument(const std::vector<uint8_t>& buf, std::string& outName, std::string& outEmail) {
        if (buf.size() < 5) return false;
        int32_t docLength = readInt32(buf, 0);
        if (docLength <= 0 || static_cast<size_t>(docLength) > buf.size()) return false;

        size_t idx = 4;
        while (idx < buf.size() && buf[idx] != 0x00) {
            uint8_t type = buf[idx++];
            // Read key (CString)
            std::string key;
            while (idx < buf.size() && buf[idx] != 0x00) {
                key.push_back(static_cast<char>(buf[idx++]));
            }
            if (idx < buf.size() && buf[idx] == 0x00) idx++; // skip null terminator

            if (type == 0x02) { // String
                int32_t strLen = readInt32(buf, idx);
                idx += 4;
                if (strLen > 0 && idx + static_cast<size_t>(strLen) <= buf.size()) {
                    std::string val(reinterpret_cast<const char*>(&buf[idx]), strLen - 1); // exclude trailing null
                    idx += strLen;
                    if (key == "Name") outName = val;
                    else if (key == "Email") outEmail = val;
                }
            }
        }
        return true;
    }
};

class SignupHandler {
private:
    static std::string sanitizeFilename(std::string name) {
        std::string clean;
        for (char c : name) {
            if (std::isalnum(c) || c == '_' || c == '-') {
                clean.push_back(c);
            } else if (c == ' ') {
                clean.push_back('_');
            }
        }
        return clean.empty() ? "user" : clean;
    }

    static std::string trim(const std::string& str) {
        size_t first = str.find_first_not_of(" \t\n\r\"");
        if (first == std::string::npos) return "";
        size_t last = str.find_last_not_of(" \t\n\r\"");
        return str.substr(first, (last - first + 1));
    }

    static std::string resolveDbsDir() {
        const std::vector<std::string> candidates = {"dbs", "../dbs", "../../dbs"};
        for (const auto& d : candidates) {
            struct stat info{};
            if (stat(d.c_str(), &info) == 0 && (info.st_mode & S_IFDIR)) {
                return d;
            }
        }
        return "dbs";
    }

public:
    static bool createJsonFile(const std::string& name, const std::string& email, std::string& outJsonPath) {
        std::string filename = sanitizeFilename(name) + ".json";
        outJsonPath = filename;

        std::ofstream jsonFile(outJsonPath);
        if (!jsonFile.is_open()) {
            std::cerr << "[SkillFlow Signup] Error creating JSON file: " << outJsonPath << "\n";
            return false;
        }

        jsonFile << "{\n\n"
                 << "Name : \"" << name << "\",\n"
                 << "Email: \"" << email << "\"\n\n\n"
                 << "}\n";
        jsonFile.close();
        return true;
    }

    static bool readJsonFile(const std::string& jsonPath, std::string& outName, std::string& outEmail) {
        std::ifstream file(jsonPath);
        if (!file.is_open()) {
            std::cerr << "[SkillFlow Signup] Could not open JSON file: " << jsonPath << "\n";
            return false;
        }

        std::string line;
        while (std::getline(file, line)) {
            size_t colon = line.find(':');
            if (colon != std::string::npos) {
                std::string key = trim(line.substr(0, colon));
                std::string val = trim(line.substr(colon + 1));
                if (!val.empty() && val.back() == ',') val.pop_back();
                val = trim(val);

                if (key == "Name" || key == "name") outName = val;
                else if (key == "Email" || key == "email") outEmail = val;
            }
        }
        return !outName.empty() && !outEmail.empty();
    }

    static bool storeBsonFile(const std::string& name, const std::string& email, std::string& outBsonPath) {
        std::string dbsDir = resolveDbsDir();
        std::string filename = sanitizeFilename(name) + ".bson";
        outBsonPath = dbsDir + "/" + filename;

        std::vector<uint8_t> bsonBytes = BsonEncoder::encodeUserDocument(name, email);

        std::ofstream bsonFile(outBsonPath, std::ios::binary);
        if (!bsonFile.is_open()) {
            std::cerr << "[SkillFlow Signup] Error writing BSON file: " << outBsonPath << "\n";
            return false;
        }

        bsonFile.write(reinterpret_cast<const char*>(bsonBytes.data()), bsonBytes.size());
        bsonFile.close();

        // Also append BSON document to dbs/users.bson for collection-level persistence
        std::string collectionBsonPath = dbsDir + "/users.bson";
        std::ofstream collFile(collectionBsonPath, std::ios::binary | std::ios::app);
        if (collFile.is_open()) {
            collFile.write(reinterpret_cast<const char*>(bsonBytes.data()), bsonBytes.size());
            collFile.close();
        }

        return true;
    }

    static void syncToUsersJson(const std::string& name, const std::string& email, const std::string& password = "password123") {
        std::string dbsDir = resolveDbsDir();
        std::string usersJsonPath = dbsDir + "/users.json";

        std::ifstream inFile(usersJsonPath);
        std::string content;
        if (inFile.is_open()) {
            content.assign((std::istreambuf_iterator<char>(inFile)), std::istreambuf_iterator<char>());
            inFile.close();
        }

        // Check if user already present in users.json
        if (content.find("\"" + email + "\"") != std::string::npos) {
            return;
        }

        // Build new user JSON entry
        std::stringstream entry;
        entry << "  {\n"
              << "    \"id\": \"usr_" << std::time(nullptr) << "\",\n"
              << "    \"email\": \"" << email << "\",\n"
              << "    \"name\": \"" << name << "\",\n"
              << "    \"password\": \"" << password << "\",\n"
              << "    \"profileCompleted\": false,\n"
              << "    \"track\": \"frontend-dev\",\n"
              << "    \"level\": \"beginner\",\n"
              << "    \"dailyTime\": 60\n"
              << "  }";

        if (content.empty() || content.find('[') == std::string::npos) {
            content = "[\n" + entry.str() + "\n]\n";
        } else {
            size_t lastBracket = content.rfind(']');
            if (lastBracket != std::string::npos) {
                size_t prevBrace = content.rfind('}', lastBracket);
                if (prevBrace != std::string::npos) {
                    content.insert(prevBrace + 1, ",\n" + entry.str());
                } else {
                    content = "[\n" + entry.str() + "\n]\n";
                }
            }
        }

        std::ofstream outFile(usersJsonPath);
        if (outFile.is_open()) {
            outFile << content;
            outFile.close();
        }
    }

    static bool processSignup(const std::string& name, const std::string& email, const std::string& password = "password123") {
        std::string jsonPath;
        if (!createJsonFile(name, email, jsonPath)) {
            return false;
        }

        std::string bsonPath;
        if (!storeBsonFile(name, email, bsonPath)) {
            return false;
        }

        syncToUsersJson(name, email, password);

        std::cout << "{\n"
                  << "  \"status\": \"success\",\n"
                  << "  \"message\": \"User registered and saved to BSON successfully.\",\n"
                  << "  \"json_file\": \"" << jsonPath << "\",\n"
                  << "  \"bson_file\": \"" << bsonPath << "\",\n"
                  << "  \"user\": {\n"
                  << "    \"Name\": \"" << name << "\",\n"
                  << "    \"Email\": \"" << email << "\"\n"
                  << "  }\n"
                  << "}\n";
        return true;
    }
};

/**
 * Optional HTTP Server Mode for Frontend fetch
 */
void runSignupHttpServer(int port) {
    int serverFd = socket(AF_INET, SOCK_STREAM, 0);
    if (serverFd < 0) return;

    int opt = 1;
    setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(port);

    if (bind(serverFd, (struct sockaddr*)&address, sizeof(address)) < 0) {
        close(serverFd);
        return;
    }

    if (listen(serverFd, 5) < 0) {
        close(serverFd);
        return;
    }

    std::cout << "[SkillFlow Signup] Server listening on http://127.0.0.1:" << port << "\n";

    while (true) {
        sockaddr_in clientAddr{};
        socklen_t clientLen = sizeof(clientAddr);
        int clientFd = accept(serverFd, (struct sockaddr*)&clientAddr, &clientLen);
        if (clientFd < 0) continue;

        char buffer[4096] = {0};
        ssize_t bytesRead = read(clientFd, buffer, sizeof(buffer) - 1);
        if (bytesRead <= 0) {
            close(clientFd);
            continue;
        }

        std::string request(buffer, bytesRead);

        if (request.rfind("OPTIONS", 0) == 0) {
            std::string cors = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n\r\n";
            write(clientFd, cors.c_str(), cors.size());
            close(clientFd);
            continue;
        }

        size_t bodyPos = request.find("\r\n\r\n");
        std::string body = (bodyPos != std::string::npos) ? request.substr(bodyPos + 4) : "";

        auto extractJson = [](const std::string& j, const std::string& field) -> std::string {
            size_t p = j.find("\"" + field + "\"");
            if (p == std::string::npos) return "";
            size_t col = j.find(':', p);
            if (col == std::string::npos) return "";
            size_t s = j.find_first_not_of(" \t\r\n\"", col + 1);
            if (s == std::string::npos) return "";
            size_t e = j.find_first_of(",}\"\r\n", s);
            return j.substr(s, e - s);
        };

        std::string name = extractJson(body, "name");
        if (name.empty()) name = extractJson(body, "Name");
        std::string email = extractJson(body, "email");
        if (email.empty()) email = extractJson(body, "Email");
        std::string password = extractJson(body, "password");
        if (password.empty()) password = "password123";

        std::stringstream resp;
        if (!name.empty() && !email.empty()) {
            std::string jsonPath, bsonPath;
            SignupHandler::createJsonFile(name, email, jsonPath);
            SignupHandler::storeBsonFile(name, email, bsonPath);
            SignupHandler::syncToUsersJson(name, email, password);

            resp << "{\n"
                 << "  \"status\": \"success\",\n"
                 << "  \"json_file\": \"" << jsonPath << "\",\n"
                 << "  \"bson_file\": \"" << bsonPath << "\",\n"
                 << "  \"user\": {\"Name\": \"" << name << "\", \"Email\": \"" << email << "\"}\n"
                 << "}";
        } else {
            resp << "{\"status\": \"error\", \"message\": \"Name and Email are required\"}";
        }

        std::string respStr = resp.str();
        std::stringstream http;
        http << "HTTP/1.1 200 OK\r\n"
             << "Content-Type: application/json\r\n"
             << "Access-Control-Allow-Origin: *\r\n"
             << "Content-Length: " << respStr.size() << "\r\n\r\n"
             << respStr;

        std::string hStr = http.str();
        write(clientFd, hStr.c_str(), hStr.size());
        close(clientFd);
    }
    close(serverFd);
}

int main(int argc, char* argv[]) {
    // Mode 1: Decode/inspect BSON file: ./backend/signup read-bson <path>
    if (argc >= 3 && std::string(argv[1]) == "read-bson") {
        std::ifstream file(argv[2], std::ios::binary);
        if (!file.is_open()) {
            std::cerr << "Could not open BSON file: " << argv[2] << "\n";
            return 1;
        }
        std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
        file.close();

        std::string name, email;
        if (BsonEncoder::decodeBsonDocument(bytes, name, email)) {
            std::cout << "Decoded BSON Document:\n";
            std::cout << "  Name : " << name << "\n";
            std::cout << "  Email: " << email << "\n";
            return 0;
        } else {
            std::cerr << "Failed to parse BSON document.\n";
            return 1;
        }
    }

    // Mode 2: HTTP server mode: ./backend/signup server [port]
    if (argc >= 2 && std::string(argv[1]) == "server") {
        int port = (argc >= 3) ? std::stoi(argv[2]) : 8082;
        runSignupHttpServer(port);
        return 0;
    }

    // Mode 3: Process existing <name>.json file: ./backend/signup <file.json>
    if (argc == 2 && std::string(argv[1]).find(".json") != std::string::npos) {
        std::string jsonPath = argv[1];
        std::string name, email;
        if (SignupHandler::readJsonFile(jsonPath, name, email)) {
            std::string bsonPath;
            if (SignupHandler::storeBsonFile(name, email, bsonPath)) {
                SignupHandler::syncToUsersJson(name, email);
                std::cout << "{\n"
                          << "  \"status\": \"success\",\n"
                          << "  \"message\": \"Loaded from " << jsonPath << " and stored as BSON.\",\n"
                          << "  \"bson_file\": \"" << bsonPath << "\",\n"
                          << "  \"user\": {\"Name\": \"" << name << "\", \"Email\": \"" << email << "\"}\n"
                          << "}\n";
                return 0;
            }
        }
        std::cerr << "Failed to process JSON file.\n";
        return 1;
    }

    // Mode 4: Name and Email CLI: ./backend/signup "<name>" "<email>" [password]
    if (argc >= 3) {
        std::string name = argv[1];
        std::string email = argv[2];
        std::string password = (argc >= 4) ? argv[3] : "password123";
        bool ok = SignupHandler::processSignup(name, email, password);
        return ok ? 0 : 1;
    }

    // Help
    std::cout << "SkillFlow Signup Processor (C++)\n";
    std::cout << "Usage:\n";
    std::cout << "  ./backend/signup \"<name>\" \"<email>\" [password]\n";
    std::cout << "  ./backend/signup <name>.json\n";
    std::cout << "  ./backend/signup read-bson dbs/<name>.bson\n";
    std::cout << "  ./backend/signup server [port=8082]\n";
    return 0;
}
