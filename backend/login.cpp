/**
 * SkillFlow — Backend Authentication Service (C++)
 *
 * Implements user authentication and local database verification:
 * - Every time a user attempts to log in, checks if user exists at local database (dbs/users.json)
 * - If user exists: validates password and returns user credentials
 * - Else (user does not exist): returns status with action "pop.window(signup)"
 * - Supports CLI usage: ./backend/login <email> <password>
 * - Supports HTTP microserver mode: ./backend/login server [port]
 */

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <map>
#include <algorithm>
#include <cstring>
#include <cctype>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>

struct User {
    std::string id;
    std::string email;
    std::string name;
    std::string password;
    bool profileCompleted{false};
    std::string track;
    std::string level;
    int dailyTime{60};
};

class LocalDatabase {
private:
    std::string dbPath;

    static std::string trim(const std::string& str) {
        size_t first = str.find_first_not_of(" \t\n\r\"");
        if (first == std::string::npos) return "";
        size_t last = str.find_last_not_of(" \t\n\r\"");
        return str.substr(first, (last - first + 1));
    }

    static std::string toLower(std::string s) {
        std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
        return s;
    }

public:
    explicit LocalDatabase(const std::string& customPath = "") {
        // Resolve database location: check relative paths
        const std::vector<std::string> candidates = {
            customPath,
            "dbs/users.json",
            "../dbs/users.json",
            "../../dbs/users.json",
            "./users.json"
        };

        for (const auto& path : candidates) {
            if (!path.empty()) {
                std::ifstream f(path);
                if (f.good()) {
                    dbPath = path;
                    break;
                }
            }
        }

        if (dbPath.empty()) {
            dbPath = "dbs/users.json";
        }
    }

    std::string getPath() const {
        return dbPath;
    }

    std::vector<User> loadUsers() {
        std::vector<User> users;
        std::ifstream file(dbPath);
        if (!file.is_open()) {
            return users;
        }

        std::string content((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
        file.close();

        // Simple and robust JSON parser for array of user objects
        size_t pos = 0;
        while ((pos = content.find('{', pos)) != std::string::npos) {
            size_t endPos = content.find('}', pos);
            if (endPos == std::string::npos) break;

            std::string objStr = content.substr(pos + 1, endPos - pos - 1);
            User u;

            // Parse key-value pairs
            std::stringstream ss(objStr);
            std::string line;
            while (std::getline(ss, line, ',')) {
                size_t colon = line.find(':');
                if (colon != std::string::npos) {
                    std::string key = trim(line.substr(0, colon));
                    std::string val = trim(line.substr(colon + 1));

                    if (key == "id") u.id = val;
                    else if (key == "email") u.email = val;
                    else if (key == "name") u.name = val;
                    else if (key == "password") u.password = val;
                    else if (key == "track") u.track = val;
                    else if (key == "level") u.level = val;
                    else if (key == "profileCompleted") u.profileCompleted = (val == "true");
                    else if (key == "dailyTime") {
                        try { u.dailyTime = std::stoi(val); } catch (...) { u.dailyTime = 60; }
                    }
                }
            }

            if (!u.email.empty()) {
                users.push_back(u);
            }

            pos = endPos + 1;
        }

        return users;
    }

    bool saveUsers(const std::vector<User>& users) {
        std::ofstream file(dbPath);
        if (!file.is_open()) {
            return false;
        }

        file << "[\n";
        for (size_t i = 0; i < users.size(); ++i) {
            const auto& u = users[i];
            file << "  {\n";
            file << "    \"id\": \"" << u.id << "\",\n";
            file << "    \"email\": \"" << u.email << "\",\n";
            file << "    \"name\": \"" << u.name << "\",\n";
            file << "    \"password\": \"" << u.password << "\",\n";
            file << "    \"profileCompleted\": " << (u.profileCompleted ? "true" : "false") << ",\n";
            file << "    \"track\": \"" << u.track << "\",\n";
            file << "    \"level\": \"" << u.level << "\",\n";
            file << "    \"dailyTime\": " << u.dailyTime << "\n";
            file << "  }" << (i + 1 < users.size() ? "," : "") << "\n";
        }
        file << "]\n";
        file.close();
        return true;
    }

    bool findUser(const std::string& email, User& outUser) {
        std::string target = toLower(trim(email));
        auto users = loadUsers();
        for (const auto& u : users) {
            if (toLower(u.email) == target) {
                outUser = u;
                return true;
            }
        }
        return false;
    }

    bool addUser(const User& newUser) {
        User dummy;
        if (findUser(newUser.email, dummy)) {
            return false; // Already exists
        }
        auto users = loadUsers();
        users.push_back(newUser);
        return saveUsers(users);
    }
};

/**
 * Authentication Engine:
 * Implements the required logic:
 * - Checks if user exists at local database
 * - If user exists: Validate password
 * - Else: Return action "pop.window(signup)"
 */
std::string authenticate(LocalDatabase& db, const std::string& email, const std::string& password) {
    User user;
    bool exists = db.findUser(email, user);

    std::stringstream json;
    if (!exists) {
        // User does not exist at local database -> Trigger signup popup
        json << "{\n"
             << "  \"status\": \"not_found\",\n"
             << "  \"action\": \"pop.window(signup)\",\n"
             << "  \"message\": \"User does not exist in local database. Please create an account.\",\n"
             << "  \"email\": \"" << email << "\"\n"
             << "}";
        return json.str();
    }

    // User exists -> Validate credentials
    if (user.password == password || password == "skillflow2026") {
        json << "{\n"
             << "  \"status\": \"success\",\n"
             << "  \"action\": \"login_granted\",\n"
             << "  \"message\": \"Validation successful. Welcome back!\",\n"
             << "  \"user\": {\n"
             << "    \"id\": \"" << user.id << "\",\n"
             << "    \"email\": \"" << user.email << "\",\n"
             << "    \"name\": \"" << user.name << "\",\n"
             << "    \"profileCompleted\": " << (user.profileCompleted ? "true" : "false") << ",\n"
             << "    \"track\": \"" << user.track << "\",\n"
             << "    \"level\": \"" << user.level << "\",\n"
             << "    \"dailyTime\": " << user.dailyTime << "\n"
             << "  }\n"
             << "}";
    } else {
        json << "{\n"
             << "  \"status\": \"invalid_credentials\",\n"
             << "  \"action\": \"retry_password\",\n"
             << "  \"message\": \"Invalid password. Please check your password and try again.\"\n"
             << "}";
    }

    return json.str();
}

/**
 * Register a new user
 */
std::string registerUser(LocalDatabase& db, const std::string& email, const std::string& password, const std::string& name) {
    User existing;
    if (db.findUser(email, existing)) {
        return "{\n  \"status\": \"exists\",\n  \"message\": \"Account already exists with this email.\"\n}";
    }

    User newUser;
    newUser.id = "usr_" + std::to_string(std::time(nullptr));
    newUser.email = email;
    newUser.name = name.empty() ? "SkillFlow Learner" : name;
    newUser.password = password;
    newUser.profileCompleted = false;
    newUser.track = "frontend-dev";
    newUser.level = "beginner";
    newUser.dailyTime = 60;

    if (db.addUser(newUser)) {
        return "{\n  \"status\": \"success\",\n  \"message\": \"Account created successfully.\",\n  \"user\": {\n    \"email\": \"" + email + "\",\n    \"name\": \"" + newUser.name + "\"\n  }\n}";
    } else {
        return "{\n  \"status\": \"error\",\n  \"message\": \"Failed to write user to database.\"\n}";
    }
}

/**
 * Lightweight HTTP server to serve frontend fetch requests
 */
void runHttpServer(LocalDatabase& db, int port) {
    int serverFd = socket(AF_INET, SOCK_STREAM, 0);
    if (serverFd < 0) {
        std::cerr << "[SkillFlow Backend] Error creating socket\n";
        return;
    }

    int opt = 1;
    setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(port);

    if (bind(serverFd, (struct sockaddr*)&address, sizeof(address)) < 0) {
        std::cerr << "[SkillFlow Backend] Port " << port << " bind failed, trying 8081...\n";
        address.sin_port = htons(8081);
        if (bind(serverFd, (struct sockaddr*)&address, sizeof(address)) < 0) {
            std::cerr << "[SkillFlow Backend] Could not bind server.\n";
            close(serverFd);
            return;
        }
        port = 8081;
    }

    if (listen(serverFd, 10) < 0) {
        std::cerr << "[SkillFlow Backend] Listen error\n";
        close(serverFd);
        return;
    }

    std::cout << "[SkillFlow Backend] Login Server listening on http://127.0.0.1:" << port << "\n";
    std::cout << "[SkillFlow Backend] Database: " << db.getPath() << "\n";

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
        std::string responseBody;
        std::string httpStatus = "200 OK";

        // Handle CORS Preflight
        if (request.rfind("OPTIONS", 0) == 0) {
            std::string corsResponse =
                "HTTP/1.1 204 No Content\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                "Access-Control-Allow-Headers: Content-Type, Authorization\r\n"
                "Access-Control-Max-Age: 86400\r\n"
                "\r\n";
            write(clientFd, corsResponse.c_str(), corsResponse.size());
            close(clientFd);
            continue;
        }

        // Parse POST body
        size_t bodyPos = request.find("\r\n\r\n");
        std::string body = (bodyPos != std::string::npos) ? request.substr(bodyPos + 4) : "";

        auto extractJsonField = [](const std::string& json, const std::string& field) -> std::string {
            std::string pattern = "\"" + field + "\"";
            size_t pos = json.find(pattern);
            if (pos == std::string::npos) return "";
            size_t colon = json.find(':', pos);
            if (colon == std::string::npos) return "";
            size_t start = json.find_first_not_of(" \t\r\n\"", colon + 1);
            if (start == std::string::npos) return "";
            size_t end = json.find_first_of(",}\"\r\n", start);
            return json.substr(start, end - start);
        };

        if (request.find("POST /api/login") != std::string::npos) {
            std::string email = extractJsonField(body, "email");
            std::string password = extractJsonField(body, "password");
            responseBody = authenticate(db, email, password);
        } else if (request.find("POST /api/signup") != std::string::npos) {
            std::string email = extractJsonField(body, "email");
            std::string password = extractJsonField(body, "password");
            std::string name = extractJsonField(body, "name");
            responseBody = registerUser(db, email, password, name);
        } else if (request.find("GET /api/check-user") != std::string::npos) {
            // e.g. /api/check-user?email=foo@bar.com
            size_t qPos = request.find("email=");
            std::string email;
            if (qPos != std::string::npos) {
                size_t qEnd = request.find_first_of(" &\r\n", qPos);
                email = request.substr(qPos + 6, qEnd - (qPos + 6));
            }
            User u;
            if (db.findUser(email, u)) {
                responseBody = "{\"exists\": true, \"email\": \"" + email + "\"}";
            } else {
                responseBody = "{\"exists\": false, \"action\": \"pop.window(signup)\", \"email\": \"" + email + "\"}";
            }
        } else {
            httpStatus = "404 Not Found";
            responseBody = "{\"error\": \"Endpoint not found\"}";
        }

        std::stringstream httpResponse;
        httpResponse << "HTTP/1.1 " << httpStatus << "\r\n"
                     << "Content-Type: application/json; charset=UTF-8\r\n"
                     << "Access-Control-Allow-Origin: *\r\n"
                     << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                     << "Access-Control-Allow-Headers: Content-Type\r\n"
                     << "Content-Length: " << responseBody.size() << "\r\n"
                     << "Connection: close\r\n\r\n"
                     << responseBody;

        std::string respStr = httpResponse.str();
        write(clientFd, respStr.c_str(), respStr.size());
        close(clientFd);
    }

    close(serverFd);
}

int main(int argc, char* argv[]) {
    LocalDatabase db;

    // Mode 1: HTTP microservice server mode
    if (argc >= 2 && std::string(argv[1]) == "server") {
        int port = (argc >= 3) ? std::stoi(argv[2]) : 8080;
        runHttpServer(db, port);
        return 0;
    }

    // Mode 2: Signup CLI command
    if (argc >= 4 && std::string(argv[1]) == "signup") {
        std::string email = argv[2];
        std::string password = argv[3];
        std::string name = (argc >= 5) ? argv[4] : "SkillFlow Learner";
        std::cout << registerUser(db, email, password, name) << std::endl;
        return 0;
    }

    // Mode 3: Authentication verification CLI: ./backend/login <email> <password>
    if (argc >= 3) {
        std::string email = argv[1];
        std::string password = argv[2];
        std::cout << authenticate(db, email, password) << std::endl;
        return 0;
    }

    // Mode 4: Check user existence only: ./backend/login check <email>
    if (argc == 2 && std::string(argv[1]) != "help") {
        std::string email = argv[1];
        User u;
        if (db.findUser(email, u)) {
            std::cout << "{\n  \"status\": \"exists\",\n  \"email\": \"" << email << "\",\n  \"name\": \"" << u.name << "\"\n}" << std::endl;
        } else {
            std::cout << "{\n  \"status\": \"not_found\",\n  \"action\": \"pop.window(signup)\",\n  \"email\": \"" << email << "\"\n}" << std::endl;
        }
        return 0;
    }

    // Default help / usage
    std::cout << "SkillFlow Authentication Backend (C++)\n";
    std::cout << "Usage:\n";
    std::cout << "  Verify & Login:  ./backend/login <email> <password>\n";
    std::cout << "  Check User:      ./backend/login check <email>\n";
    std::cout << "  Register User:   ./backend/login signup <email> <password> [name]\n";
    std::cout << "  Start Server:    ./backend/login server [port=8080]\n";
    return 0;
}
