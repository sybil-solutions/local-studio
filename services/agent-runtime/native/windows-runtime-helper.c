#include <windows.h>
#include <aclapi.h>
#include <softpub.h>
#include <wintrust.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

static int failed(int code) {
  fwprintf(stderr, L"Local Studio runtime helper failed (%d)\n", code);
  return code;
}

static wchar_t *quoted_command_line(int argc, wchar_t **argv) {
  size_t capacity = 1;
  for (int index = 0; index < argc; index += 1) capacity += 3 + (wcslen(argv[index]) * 2);
  wchar_t *line = calloc(capacity, sizeof(wchar_t));
  if (!line) return NULL;
  wchar_t *output = line;
  for (int index = 0; index < argc; index += 1) {
    if (index > 0) *output++ = L' ';
    *output++ = L'"';
    size_t slashes = 0;
    for (const wchar_t *input = argv[index];; input += 1) {
      if (*input == L'\\') {
        slashes += 1;
        continue;
      }
      if (*input == L'"') {
        for (size_t count = 0; count < (slashes * 2) + 1; count += 1) *output++ = L'\\';
        *output++ = L'"';
        slashes = 0;
        continue;
      }
      if (*input == L'\0') {
        for (size_t count = 0; count < slashes * 2; count += 1) *output++ = L'\\';
        break;
      }
      for (size_t count = 0; count < slashes; count += 1) *output++ = L'\\';
      slashes = 0;
      *output++ = *input;
    }
    *output++ = L'"';
  }
  *output = L'\0';
  return line;
}

static DWORD active_job_processes(HANDLE job) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information;
  ZeroMemory(&information, sizeof(information));
  if (!QueryInformationJobObject(
          job,
          JobObjectBasicAccountingInformation,
          &information,
          sizeof(information),
          NULL)) {
    return MAXDWORD;
  }
  return information.ActiveProcesses;
}

static int run_job(int argc, wchar_t **argv) {
  if (argc < 1) return failed(10);
  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (!job) return failed(11);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
  ZeroMemory(&limits, sizeof(limits));
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    CloseHandle(job);
    return failed(12);
  }
  wchar_t *line = quoted_command_line(argc, argv);
  if (!line) {
    CloseHandle(job);
    return failed(13);
  }
  STARTUPINFOW startup;
  PROCESS_INFORMATION process;
  ZeroMemory(&startup, sizeof(startup));
  ZeroMemory(&process, sizeof(process));
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  DWORD flags = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED;
  BOOL created = CreateProcessW(argv[0], line, NULL, NULL, TRUE, flags, NULL, NULL, &startup, &process);
  free(line);
  if (!created) {
    CloseHandle(job);
    return failed(14);
  }
  if (!AssignProcessToJobObject(job, process.hProcess)) {
    TerminateProcess(process.hProcess, 1);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    return failed(15);
  }
  if (ResumeThread(process.hThread) == MAXDWORD) {
    TerminateJobObject(job, 1);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    return failed(16);
  }
  CloseHandle(process.hThread);
  DWORD direct_exit = 0;
  for (;;) {
    DWORD active = active_job_processes(job);
    if (active == MAXDWORD) {
      TerminateJobObject(job, 1);
      CloseHandle(process.hProcess);
      CloseHandle(job);
      return failed(17);
    }
    if (active == 0) break;
    Sleep(10);
  }
  GetExitCodeProcess(process.hProcess, &direct_exit);
  CloseHandle(process.hProcess);
  CloseHandle(job);
  return (int)direct_exit;
}

static PSID current_user_sid(HANDLE *token, void **storage) {
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, token)) return NULL;
  DWORD size = 0;
  GetTokenInformation(*token, TokenUser, NULL, 0, &size);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER) return NULL;
  *storage = calloc(1, size);
  if (!*storage) return NULL;
  if (!GetTokenInformation(*token, TokenUser, *storage, size, &size)) return NULL;
  return ((TOKEN_USER *)*storage)->User.Sid;
}

static HANDLE secure_path_handle(const wchar_t *path, BOOL directory, BOOL protect) {
  DWORD flags = FILE_FLAG_OPEN_REPARSE_POINT;
  if (directory) flags |= FILE_FLAG_BACKUP_SEMANTICS;
  HANDLE handle = CreateFileW(
      path,
      READ_CONTROL | FILE_READ_ATTRIBUTES | (protect ? WRITE_DAC : 0),
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      NULL,
      OPEN_EXISTING,
      flags,
      NULL);
  if (handle == INVALID_HANDLE_VALUE) return NULL;
  FILE_ATTRIBUTE_TAG_INFO attributes;
  if (!GetFileInformationByHandleEx(
          handle,
          FileAttributeTagInfo,
          &attributes,
          sizeof(attributes)) ||
      (attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
      (((attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) != directory)) {
    CloseHandle(handle);
    return NULL;
  }
  return handle;
}

static DWORD acl_mask(BOOL private_access) {
  return private_access ? FILE_ALL_ACCESS : FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
}

static BOOL verify_acl_handle(HANDLE handle, PSID user, BOOL directory, BOOL private_access) {
  PSID owner = NULL;
  PACL dacl = NULL;
  PSECURITY_DESCRIPTOR descriptor = NULL;
  DWORD result = GetSecurityInfo(
      handle,
      SE_FILE_OBJECT,
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      &owner,
      NULL,
      &dacl,
      NULL,
      &descriptor);
  if (result != ERROR_SUCCESS || !owner || !dacl || !EqualSid(owner, user)) {
    if (descriptor) LocalFree(descriptor);
    return FALSE;
  }
  SECURITY_DESCRIPTOR_CONTROL control = 0;
  DWORD revision = 0;
  ACL_SIZE_INFORMATION size;
  ZeroMemory(&size, sizeof(size));
  BOOL valid = GetSecurityDescriptorControl(descriptor, &control, &revision) &&
               (control & SE_DACL_PROTECTED) != 0 &&
               GetAclInformation(dacl, &size, sizeof(size), AclSizeInformation) &&
               size.AceCount == 1;
  void *entry = NULL;
  if (valid) valid = GetAce(dacl, 0, &entry);
  if (valid) {
    ACCESS_ALLOWED_ACE *ace = entry;
    BYTE expected_flags = directory ? OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE : 0;
    valid = ace->Header.AceType == ACCESS_ALLOWED_ACE_TYPE &&
            ace->Header.AceFlags == expected_flags &&
            (ace->Header.AceFlags & INHERITED_ACE) == 0 &&
            ace->Mask == acl_mask(private_access) &&
            EqualSid(&ace->SidStart, user);
  }
  LocalFree(descriptor);
  return valid;
}

static int verify_acl(const wchar_t *path, BOOL directory, BOOL private_access, BOOL protect) {
  HANDLE token = NULL;
  void *storage = NULL;
  PSID user = current_user_sid(&token, &storage);
  if (!user) {
    if (storage) free(storage);
    if (token) CloseHandle(token);
    return failed(20);
  }
  HANDLE handle = secure_path_handle(path, directory, protect);
  if (!handle) {
    free(storage);
    CloseHandle(token);
    return failed(21);
  }
  if (protect) {
    DWORD acl_size = sizeof(ACL) + sizeof(ACCESS_ALLOWED_ACE) + GetLengthSid(user);
    PACL acl = calloc(1, acl_size);
    BYTE flags = directory ? OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE : 0;
    BOOL ready = acl && InitializeAcl(acl, acl_size, ACL_REVISION) &&
                 AddAccessAllowedAceEx(acl, ACL_REVISION, flags, acl_mask(private_access), user);
    DWORD result = ready
                       ? SetSecurityInfo(
                             handle,
                             SE_FILE_OBJECT,
                             DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                             NULL,
                             NULL,
                             acl,
                             NULL)
                       : ERROR_INVALID_ACL;
    if (acl) free(acl);
    if (result != ERROR_SUCCESS) {
      CloseHandle(handle);
      free(storage);
      CloseHandle(token);
      return failed(22);
    }
  }
  BOOL valid = verify_acl_handle(handle, user, directory, private_access);
  CloseHandle(handle);
  free(storage);
  CloseHandle(token);
  if (!valid) return failed(23);
  fputws(L"{\"ok\":true}\n", stdout);
  return 0;
}

static int verify_trust(const wchar_t *path) {
  GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
  WINTRUST_FILE_INFO file;
  WINTRUST_DATA data;
  ZeroMemory(&file, sizeof(file));
  ZeroMemory(&data, sizeof(data));
  file.cbStruct = sizeof(file);
  file.pcwszFilePath = path;
  data.cbStruct = sizeof(data);
  data.dwUIChoice = WTD_UI_NONE;
  data.fdwRevocationChecks = WTD_REVOKE_NONE;
  data.dwUnionChoice = WTD_CHOICE_FILE;
  data.pFile = &file;
  data.dwStateAction = WTD_STATEACTION_VERIFY;
  data.dwProvFlags = WTD_SAFER_FLAG;
  LONG result = WinVerifyTrust(INVALID_HANDLE_VALUE, &policy, &data);
  data.dwStateAction = WTD_STATEACTION_CLOSE;
  WinVerifyTrust(INVALID_HANDLE_VALUE, &policy, &data);
  if (result != ERROR_SUCCESS) return failed(30);
  fputws(L"{\"ok\":true}\n", stdout);
  return 0;
}

int wmain(int argc, wchar_t **argv) {
  if (argc >= 3 && wcscmp(argv[1], L"run-job") == 0) return run_job(argc - 2, argv + 2);
  if (argc == 3 && wcscmp(argv[1], L"verify-trust") == 0) return verify_trust(argv[2]);
  BOOL private_access = argc == 5 && wcscmp(argv[2], L"private") == 0;
  BOOL snapshot_access = argc == 5 && wcscmp(argv[2], L"snapshot") == 0;
  BOOL directory = argc == 5 && wcscmp(argv[3], L"directory") == 0;
  BOOL file = argc == 5 && wcscmp(argv[3], L"file") == 0;
  if ((!private_access && !snapshot_access) || (!directory && !file)) return failed(1);
  if (wcscmp(argv[1], L"protect-acl") == 0) {
    return verify_acl(argv[4], directory, private_access, TRUE);
  }
  if (wcscmp(argv[1], L"verify-acl") == 0) {
    return verify_acl(argv[4], directory, private_access, FALSE);
  }
  return failed(1);
}
