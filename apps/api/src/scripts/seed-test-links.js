"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
var supabase_js_1 = require("@supabase/supabase-js");
var dotenv_1 = require("dotenv");
var logger_1 = require("../lib/logger");
// Load environment variables
(0, dotenv_1.config)();
var _a = process.env, SUPABASE_URL = _a.SUPABASE_URL, SUPABASE_SERVICE_TOKEN = _a.SUPABASE_SERVICE_TOKEN;
if (!SUPABASE_URL || !SUPABASE_SERVICE_TOKEN) {
    throw new Error('Missing required environment variables');
}
// Create Supabase client
var supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_TOKEN);
function seedTestLinks() {
    return __awaiter(this, void 0, void 0, function () {
        var testLinks, _a, data, error, error_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    logger_1.logger.info('Starting to seed test broken links...');
                    testLinks = [
                        {
                            project_id: 1,
                            page_url: 'https://example.com/docs/guide',
                            extracted_link: 'https://example.com/docs/old-page',
                            status_code: 404,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://example.com/docs/new-page',
                            anchor_text: 'Read the documentation',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/blog',
                            extracted_link: 'https://external-site.com/broken',
                            status_code: 500,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: null,
                            anchor_text: 'External Resource',
                            is_internal: false
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/products',
                            extracted_link: 'https://example.com/discontinued-product',
                            status_code: 404,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://example.com/new-product',
                            anchor_text: 'View Product',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/about',
                            extracted_link: 'https://example.com/team/former-employee',
                            status_code: 404,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://example.com/team',
                            anchor_text: 'Team Member Profile',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/resources',
                            extracted_link: 'https://api.example.com/v1/deprecated',
                            status_code: 503,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://api.example.com/v2/current',
                            anchor_text: 'API Documentation',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/docs/tutorials',
                            extracted_link: 'https://example.com/docs/tutorials/getting-started/old',
                            status_code: 301,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://example.com/docs/tutorials/getting-started/new',
                            anchor_text: 'Getting Started Guide',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/blog/tech-news',
                            extracted_link: 'https://example.com/blog/archived/2020/article',
                            status_code: 410,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://example.com/blog/tech-news/latest',
                            anchor_text: 'Read More',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/downloads',
                            extracted_link: 'https://cdn.example.com/files/v1/software.zip',
                            status_code: 502,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://cdn.example.com/files/v2/software.zip',
                            anchor_text: 'Download Software',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/support',
                            extracted_link: 'https://help.external-service.com/integration',
                            status_code: 504,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: null,
                            anchor_text: 'Integration Guide',
                            is_internal: false
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/docs/api/v1',
                            extracted_link: 'https://example.com/docs/api/v1/endpoints/deprecated',
                            status_code: 404,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://example.com/docs/api/v2/endpoints',
                            anchor_text: 'API Endpoints',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/community',
                            extracted_link: 'https://forum.example.com/old-category',
                            status_code: 404,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://forum.example.com/new-category',
                            anchor_text: 'Visit Forums',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/pricing',
                            extracted_link: 'https://example.com/plans/enterprise/2023',
                            status_code: 404,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://example.com/plans/enterprise/2024',
                            anchor_text: 'Enterprise Plans',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/blog/tutorials',
                            extracted_link: 'https://github.com/example/deprecated-repo',
                            status_code: 404,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://github.com/example/new-repo',
                            anchor_text: 'Source Code',
                            is_internal: false
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/resources/ebooks',
                            extracted_link: 'https://example.com/assets/pdf/old-guide.pdf',
                            status_code: 404,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://example.com/assets/pdf/updated-guide.pdf',
                            anchor_text: 'Download PDF Guide',
                            is_internal: true
                        },
                        {
                            project_id: 1,
                            page_url: 'https://example.com/careers',
                            extracted_link: 'https://jobs.example.com/positions/senior-dev-2023',
                            status_code: 404,
                            last_checked: new Date().toISOString(),
                            suggested_alternative: 'https://jobs.example.com/positions/senior-dev-2024',
                            anchor_text: 'Apply Now',
                            is_internal: true
                        }
                    ];
                    return [4 /*yield*/, supabase
                            .from('links')
                            .upsert(testLinks, {
                            onConflict: 'project_id,page_url,extracted_link'
                        })];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error) {
                        throw error;
                    }
                    logger_1.logger.info('Successfully seeded test broken links', {
                        count: testLinks.length,
                        projectId: 1
                    });
                    return [2 /*return*/, data];
                case 2:
                    error_1 = _b.sent();
                    logger_1.logger.error('Failed to seed test broken links', { error: error_1 });
                    throw error_1;
                case 3: return [2 /*return*/];
            }
        });
    });
}
// Run the seeding
seedTestLinks()
    .then(function () {
    logger_1.logger.info('Seeding completed successfully');
    process.exit(0);
})["catch"](function (error) {
    logger_1.logger.error('Seeding failed', { error: error });
    process.exit(1);
});
