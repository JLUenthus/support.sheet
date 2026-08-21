// ============================================================
// GPO Analyzer – CIS Windows Server catalog
// V5.2 Start: server-specific CIS benchmark catalog.
//
// Bewusst noch KEINE Compliance-Berechnung und kein Score.
// Die Daten stammen aus den bereitgestellten CIS-Benchmarks 2019/2022/2025.
// ============================================================
window.GpoCisServer = (function() {
  let _catalog = null;

  const VERSION_MARKERS = {
    '2019': ['server 2019', 'windows server 2019'],
    '2022': ['server 2022', 'windows server 2022'],
    '2025': ['server 2025', 'windows server 2025'],
  };


  // V5.2 Mapping A: verified Account Policies + Security Options mappings.
  // Kept in JS so the base catalog remains immutable and every mapping
  // step is reapplied from one runtime source of truth.
  const BASELINE_SETTING_MAPPINGS = {
    "windows-server-2019": {
        "1.1.1": [
            "PasswordHistorySize"
        ],
        "1.1.2": [
            "MaximumPasswordAge"
        ],
        "1.1.3": [
            "MinimumPasswordAge"
        ],
        "1.1.4": [
            "MinimumPasswordLength"
        ],
        "1.1.5": [
            "PasswordComplexity"
        ],
        "1.1.6": [
            "StorePasswordsUsingReversibleEncryption"
        ],
        "1.2.1": [
            "LockoutDuration"
        ],
        "1.2.2": [
            "LockoutBadCount"
        ],
        "1.2.3": [
            "AllowAdministratorLockout"
        ],
        "1.2.4": [
            "ResetLockoutCount"
        ],
        "2.3.1.1": [
            "Accounts: Guest account status"
        ],
        "2.3.1.2": [
            "Accounts: Limit local account use of blank passwords to console logon only"
        ],
        "2.3.1.3": [
            "Accounts: Rename administrator account"
        ],
        "2.3.1.4": [
            "Accounts: Rename guest account"
        ],
        "2.3.2.1": [
            "Audit: Force audit policy subcategory settings (Windows Vista or later) to override audit policy category settings"
        ],
        "2.3.2.2": [
            "Audit: Shut down system immediately if unable to log security audits"
        ],
        "2.3.4.1": [
            "Devices: Prevent users from installing printer drivers"
        ],
        "2.3.5.1": [
            "Domain controller: Allow server operators to schedule tasks"
        ],
        "2.3.5.2": [
            "Domain controller: Allow vulnerable Netlogon secure channel connections"
        ],
        "2.3.5.3": [
            "Domain controller: LDAP server channel binding token requirements"
        ],
        "2.3.5.4": [
            "Domain controller: LDAP server signing requirements"
        ],
        "2.3.5.5": [
            "Domain controller: Refuse machine account password changes"
        ],
        "2.3.6.1": [
            "Domain member: Digitally encrypt or sign secure channel data (always)"
        ],
        "2.3.6.2": [
            "Domain member: Digitally encrypt secure channel data (when possible)"
        ],
        "2.3.6.3": [
            "Domain member: Digitally sign secure channel data (when possible)"
        ],
        "2.3.6.4": [
            "Domain member: Disable machine account password changes"
        ],
        "2.3.6.5": [
            "Domain member: Maximum machine account password age"
        ],
        "2.3.6.6": [
            "Domain member: Require strong (Windows 2000 or later) session key"
        ],
        "2.3.7.1": [
            "Interactive logon: Do not require CTRL+ALT+DEL"
        ],
        "2.3.7.2": [
            "Interactive logon: Don"
        ],
        "2.3.7.3": [
            "Interactive logon: Machine inactivity limit"
        ],
        "2.3.7.4": [
            "Interactive logon: Message text for users attempting to log on"
        ],
        "2.3.7.5": [
            "Interactive logon: Message title for users attempting to log on"
        ],
        "2.3.7.6": [
            "Interactive logon: Number of previous logons to cache (in case domain controller is not available)"
        ],
        "2.3.7.7": [
            "Interactive logon: Prompt user to change password before expiration"
        ],
        "2.3.7.8": [
            "Interactive logon: Require Domain Controller Authentication to unlock workstation"
        ],
        "2.3.7.9": [
            "Interactive logon: Smart card removal behavior"
        ],
        "2.3.8.1": [
            "Microsoft network client: Digitally sign communications (always)"
        ],
        "2.3.8.2": [
            "Microsoft network client: Send unencrypted password to third-party SMB servers"
        ],
        "2.3.9.1": [
            "Microsoft network server: Amount of idle time required before suspending session"
        ],
        "2.3.9.2": [
            "Microsoft network server: Digitally sign communications (always)"
        ],
        "2.3.9.3": [
            "Microsoft network server: Disconnect clients when logon hours expire"
        ],
        "2.3.9.4": [
            "Microsoft network server: Server SPN target name validation level"
        ],
        "2.3.10.1": [
            "Network access: Allow anonymous SID/Name translation"
        ],
        "2.3.10.2": [
            "Network access: Do not allow anonymous enumeration of SAM accounts"
        ],
        "2.3.10.3": [
            "Network access: Do not allow anonymous enumeration of SAM accounts and shares"
        ],
        "2.3.10.4": [
            "Network access: Do not allow storage of passwords and credentials for network authentication"
        ],
        "2.3.10.5": [
            "Network access: Let Everyone permissions apply to anonymous users"
        ],
        "2.3.10.6": [
            "Network access: Named Pipes that can be accessed anonymously"
        ],
        "2.3.10.7": [
            "Network access: Named Pipes that can be accessed anonymously"
        ],
        "2.3.10.8": [
            "Network access: Remotely accessible registry paths"
        ],
        "2.3.10.9": [
            "Network access: Remotely accessible registry paths and sub-paths"
        ],
        "2.3.10.10": [
            "Network access: Restrict anonymous access to Named Pipes and Shares"
        ],
        "2.3.10.11": [
            "Network access: Restrict clients allowed to make remote calls to SAM"
        ],
        "2.3.10.12": [
            "Network access: Shares that can be accessed anonymously"
        ],
        "2.3.10.13": [
            "Network access: Sharing and security model for local accounts"
        ],
        "2.3.11.1": [
            "Network security: Allow Local System to use computer identity for NTLM"
        ],
        "2.3.11.2": [
            "Network security: Allow LocalSystem NULL session fallback"
        ],
        "2.3.11.3": [
            "Network Security: Allow PKU2U authentication requests to this computer to use online identities"
        ],
        "2.3.11.4": [
            "Network security: Configure encryption types allowed for Kerberos"
        ],
        "2.3.11.5": [
            "Network security: Do not store LAN Manager hash value on next password change"
        ],
        "2.3.11.6": [
            "Network security: Force logoff when logon hours expire"
        ],
        "2.3.11.7": [
            "Network security: LAN Manager authentication level"
        ],
        "2.3.11.8": [
            "Network security: LDAP client signing requirements"
        ],
        "2.3.11.9": [
            "Network security: Minimum session security for NTLM SSP based (including secure RPC) clients"
        ],
        "2.3.11.10": [
            "Network security: Minimum session security for NTLM SSP based (including secure RPC) servers"
        ],
        "2.3.11.11": [
            "Network security: Restrict NTLM: Audit Incoming NTLM Traffic"
        ],
        "2.3.11.12": [
            "Network security: Restrict NTLM: Audit NTLM authentication in this domain"
        ],
        "2.3.11.13": [
            "Network security: Restrict NTLM: Outgoing NTLM traffic to remote servers"
        ],
        "2.3.13.1": [
            "Shutdown: Allow system to be shut down without having to log on"
        ],
        "2.3.15.1": [
            "System objects: Require case insensitivity for non-Windows subsystems"
        ],
        "2.3.15.2": [
            "System objects: Strengthen default permissions of internal system objects (e.g. Symbolic Links)"
        ],
        "2.3.17.1": [
            "User Account Control: Admin Approval Mode for the Built-in Administrator account"
        ],
        "2.3.17.2": [
            "User Account Control: Behavior of the elevation prompt for administrators in Admin Approval Mode"
        ],
        "2.3.17.3": [
            "User Account Control: Behavior of the elevation prompt for standard users"
        ],
        "2.3.17.4": [
            "User Account Control: Detect application installations and prompt for elevation"
        ],
        "2.3.17.5": [
            "User Account Control: Only elevate UIAccess applications that are installed in secure locations"
        ],
        "2.3.17.6": [
            "User Account Control: Run all administrators in Admin Approval Mode"
        ],
        "2.3.17.7": [
            "User Account Control: Switch to the secure desktop when prompting for elevation"
        ],
        "2.3.17.8": [
            "User Account Control: Virtualize file and registry write failures to per-user locations"
        ]
    },
    "windows-server-2022": {
        "1.1.1": [
            "PasswordHistorySize"
        ],
        "1.1.2": [
            "MaximumPasswordAge"
        ],
        "1.1.3": [
            "MinimumPasswordAge"
        ],
        "1.1.4": [
            "MinimumPasswordLength"
        ],
        "1.1.5": [
            "PasswordComplexity"
        ],
        "1.1.6": [
            "StorePasswordsUsingReversibleEncryption"
        ],
        "1.1.7": [
            "RelaxMinimumPasswordLengthLimits"
        ],
        "1.2.1": [
            "LockoutDuration"
        ],
        "1.2.2": [
            "LockoutBadCount"
        ],
        "1.2.3": [
            "AllowAdministratorLockout"
        ],
        "1.2.4": [
            "ResetLockoutCount"
        ],
        "2.3.1.1": [
            "Accounts: Guest account status"
        ],
        "2.3.1.2": [
            "Accounts: Limit local account use of blank passwords to console logon only"
        ],
        "2.3.1.3": [
            "Accounts: Rename administrator account"
        ],
        "2.3.1.4": [
            "Accounts: Rename guest account"
        ],
        "2.3.2.1": [
            "Audit: Force audit policy subcategory settings (Windows Vista or later) to override audit policy category settings"
        ],
        "2.3.2.2": [
            "Audit: Shut down system immediately if unable to log security audits"
        ],
        "2.3.4.1": [
            "Devices: Prevent users from installing printer drivers"
        ],
        "2.3.5.1": [
            "Domain controller: Allow server operators to schedule tasks"
        ],
        "2.3.5.2": [
            "Domain controller: Allow vulnerable Netlogon secure channel connections"
        ],
        "2.3.5.3": [
            "Domain controller: LDAP server channel binding token requirements"
        ],
        "2.3.5.4": [
            "Domain controller: LDAP server signing requirements"
        ],
        "2.3.5.5": [
            "Domain controller: Refuse machine account password changes"
        ],
        "2.3.6.1": [
            "Domain member: Digitally encrypt or sign secure channel data (always)"
        ],
        "2.3.6.2": [
            "Domain member: Digitally encrypt secure channel data (when possible)"
        ],
        "2.3.6.3": [
            "Domain member: Digitally sign secure channel data (when possible)"
        ],
        "2.3.6.4": [
            "Domain member: Disable machine account password changes"
        ],
        "2.3.6.5": [
            "Domain member: Maximum machine account password age"
        ],
        "2.3.6.6": [
            "Domain member: Require strong (Windows 2000 or later) session key"
        ],
        "2.3.7.1": [
            "Interactive logon: Do not require CTRL+ALT+DEL"
        ],
        "2.3.7.2": [
            "Interactive logon: Don"
        ],
        "2.3.7.3": [
            "Interactive logon: Machine inactivity limit"
        ],
        "2.3.7.4": [
            "Interactive logon: Message text for users attempting to log on"
        ],
        "2.3.7.5": [
            "Interactive logon: Message title for users attempting to log on"
        ],
        "2.3.7.6": [
            "Interactive logon: Number of previous logons to cache (in case domain controller is not available)"
        ],
        "2.3.7.7": [
            "Interactive logon: Prompt user to change password before expiration"
        ],
        "2.3.7.8": [
            "Interactive logon: Require Domain Controller Authentication to unlock workstation"
        ],
        "2.3.7.9": [
            "Interactive logon: Smart card removal behavior"
        ],
        "2.3.8.1": [
            "Microsoft network client: Digitally sign communications (always)"
        ],
        "2.3.8.2": [
            "Microsoft network client: Send unencrypted password to third-party SMB servers"
        ],
        "2.3.9.1": [
            "Microsoft network server: Amount of idle time required before suspending session"
        ],
        "2.3.9.2": [
            "Microsoft network server: Digitally sign communications (always)"
        ],
        "2.3.9.3": [
            "Microsoft network server: Disconnect clients when logon hours expire"
        ],
        "2.3.9.4": [
            "Microsoft network server: Server SPN target name validation level"
        ],
        "2.3.10.1": [
            "Network access: Allow anonymous SID/Name translation"
        ],
        "2.3.10.2": [
            "Network access: Do not allow anonymous enumeration of SAM accounts"
        ],
        "2.3.10.3": [
            "Network access: Do not allow anonymous enumeration of SAM accounts and shares"
        ],
        "2.3.10.4": [
            "Network access: Do not allow storage of passwords and credentials for network authentication"
        ],
        "2.3.10.5": [
            "Network access: Let Everyone permissions apply to anonymous users"
        ],
        "2.3.10.6": [
            "Network access: Named Pipes that can be accessed anonymously"
        ],
        "2.3.10.7": [
            "Network access: Named Pipes that can be accessed anonymously"
        ],
        "2.3.10.8": [
            "Network access: Remotely accessible registry paths"
        ],
        "2.3.10.9": [
            "Network access: Remotely accessible registry paths and sub-paths"
        ],
        "2.3.10.10": [
            "Network access: Restrict anonymous access to Named Pipes and Shares"
        ],
        "2.3.10.11": [
            "Network access: Restrict clients allowed to make remote calls to SAM"
        ],
        "2.3.10.12": [
            "Network access: Shares that can be accessed anonymously"
        ],
        "2.3.10.13": [
            "Network access: Sharing and security model for local accounts"
        ],
        "2.3.11.1": [
            "Network security: Allow Local System to use computer identity for NTLM"
        ],
        "2.3.11.2": [
            "Network security: Allow LocalSystem NULL session fallback"
        ],
        "2.3.11.3": [
            "Network Security: Allow PKU2U authentication requests to this computer to use online identities"
        ],
        "2.3.11.4": [
            "Network security: Configure encryption types allowed for Kerberos"
        ],
        "2.3.11.5": [
            "Network security: Do not store LAN Manager hash value on next password change"
        ],
        "2.3.11.6": [
            "Network security: Force logoff when logon hours expire"
        ],
        "2.3.11.7": [
            "Network security: LAN Manager authentication level"
        ],
        "2.3.11.8": [
            "Network security: LDAP client signing requirements"
        ],
        "2.3.11.9": [
            "Network security: Minimum session security for NTLM SSP based (including secure RPC) clients"
        ],
        "2.3.11.10": [
            "Network security: Minimum session security for NTLM SSP based (including secure RPC) servers"
        ],
        "2.3.11.11": [
            "Network security: Restrict NTLM: Audit Incoming NTLM Traffic"
        ],
        "2.3.11.12": [
            "Network security: Restrict NTLM: Audit NTLM authentication in this domain"
        ],
        "2.3.11.13": [
            "Network security: Restrict NTLM: Outgoing NTLM traffic to remote servers"
        ],
        "2.3.13.1": [
            "Shutdown: Allow system to be shut down without having to log on"
        ],
        "2.3.15.1": [
            "System objects: Require case insensitivity for non-Windows subsystems"
        ],
        "2.3.15.2": [
            "System objects: Strengthen default permissions of internal system objects (e.g. Symbolic Links)"
        ],
        "2.3.17.1": [
            "User Account Control: Admin Approval Mode for the Built-in Administrator account"
        ],
        "2.3.17.2": [
            "User Account Control: Behavior of the elevation prompt for administrators in Admin Approval Mode"
        ],
        "2.3.17.3": [
            "User Account Control: Behavior of the elevation prompt for standard users"
        ],
        "2.3.17.4": [
            "User Account Control: Detect application installations and prompt for elevation"
        ],
        "2.3.17.5": [
            "User Account Control: Only elevate UIAccess applications that are installed in secure locations"
        ],
        "2.3.17.6": [
            "User Account Control: Run all administrators in Admin Approval Mode"
        ],
        "2.3.17.7": [
            "User Account Control: Switch to the secure desktop when prompting for elevation"
        ],
        "2.3.17.8": [
            "User Account Control: Virtualize file and registry write failures to per-user locations"
        ]
    },
    "windows-server-2025": {
        "1.1.1": [
            "PasswordHistorySize"
        ],
        "1.1.2": [
            "MaximumPasswordAge"
        ],
        "1.1.3": [
            "MinimumPasswordAge"
        ],
        "1.1.4": [
            "MinimumPasswordLength"
        ],
        "1.1.5": [
            "PasswordComplexity"
        ],
        "1.1.6": [
            "StorePasswordsUsingReversibleEncryption"
        ],
        "1.1.7": [
            "RelaxMinimumPasswordLengthLimits"
        ],
        "1.2.1": [
            "LockoutDuration"
        ],
        "1.2.2": [
            "LockoutBadCount"
        ],
        "1.2.3": [
            "AllowAdministratorLockout"
        ],
        "1.2.4": [
            "ResetLockoutCount"
        ],
        "2.3.1.1": [
            "Accounts: Guest account status"
        ],
        "2.3.1.2": [
            "Accounts: Limit local account use of blank passwords to console logon only"
        ],
        "2.3.1.3": [
            "Accounts: Rename administrator account"
        ],
        "2.3.1.4": [
            "Accounts: Rename guest account"
        ],
        "2.3.2.1": [
            "Audit: Force audit policy subcategory settings (Windows Vista or later) to override audit policy category settings"
        ],
        "2.3.2.2": [
            "Audit: Shut down system immediately if unable to log security audits"
        ],
        "2.3.4.1": [
            "Devices: Prevent users from installing printer drivers"
        ],
        "2.3.5.1": [
            "Domain controller: Allow server operators to schedule tasks"
        ],
        "2.3.5.2": [
            "Domain controller: Allow vulnerable Netlogon secure channel connections"
        ],
        "2.3.5.3": [
            "Domain controller: LDAP server channel binding token requirements"
        ],
        "2.3.5.4": [
            "Domain controller: LDAP server signing requirements Enforcement"
        ],
        "2.3.5.5": [
            "Domain controller: Refuse machine account password changes"
        ],
        "2.3.6.1": [
            "Domain member: Digitally encrypt or sign secure channel data (always)"
        ],
        "2.3.6.2": [
            "Domain member: Digitally encrypt secure channel data (when possible)"
        ],
        "2.3.6.3": [
            "Domain member: Digitally sign secure channel data (when possible)"
        ],
        "2.3.6.4": [
            "Domain member: Disable machine account password changes"
        ],
        "2.3.6.5": [
            "Domain member: Maximum machine account password age"
        ],
        "2.3.6.6": [
            "Domain member: Require strong (Windows 2000 or later) session key"
        ],
        "2.3.7.1": [
            "Interactive logon: Do not require CTRL+ALT+DEL"
        ],
        "2.3.7.2": [
            "Interactive logon: Don"
        ],
        "2.3.7.3": [
            "Interactive logon: Machine inactivity limit"
        ],
        "2.3.7.4": [
            "Interactive logon: Message text for users attempting to log on"
        ],
        "2.3.7.5": [
            "Interactive logon: Message title for users attempting to log on"
        ],
        "2.3.7.6": [
            "Interactive logon: Number of previous logons to cache (in case domain controller is not available)"
        ],
        "2.3.7.7": [
            "Interactive logon: Prompt user to change password before expiration"
        ],
        "2.3.7.8": [
            "Interactive logon: Require Domain Controller Authentication to unlock workstation"
        ],
        "2.3.7.9": [
            "Interactive logon: Smart card removal behavior"
        ],
        "2.3.8.1": [
            "Microsoft network client: Digitally sign communications (always)"
        ],
        "2.3.8.2": [
            "Microsoft network client: Send unencrypted password to third-party SMB servers"
        ],
        "2.3.9.1": [
            "Microsoft network server: Amount of idle time required before suspending session"
        ],
        "2.3.9.2": [
            "Microsoft network server: Digitally sign communications (always)"
        ],
        "2.3.9.3": [
            "Microsoft network server: Disconnect clients when logon hours expire"
        ],
        "2.3.9.4": [
            "Microsoft network server: Server SPN target name validation level"
        ],
        "2.3.10.1": [
            "Network access: Allow anonymous SID/Name translation"
        ],
        "2.3.10.2": [
            "Network access: Do not allow anonymous enumeration of SAM accounts"
        ],
        "2.3.10.3": [
            "Network access: Do not allow anonymous enumeration of SAM accounts and shares"
        ],
        "2.3.10.4": [
            "Network access: Do not allow storage of passwords and credentials for network authentication"
        ],
        "2.3.10.5": [
            "Network access: Let Everyone permissions apply to anonymous users"
        ],
        "2.3.10.6": [
            "Network access: Named Pipes that can be accessed anonymously"
        ],
        "2.3.10.7": [
            "Network access: Named Pipes that can be accessed anonymously"
        ],
        "2.3.10.8": [
            "Network access: Remotely accessible registry paths"
        ],
        "2.3.10.9": [
            "Network access: Remotely accessible registry paths and sub-paths"
        ],
        "2.3.10.10": [
            "Network access: Restrict anonymous access to Named Pipes and Shares"
        ],
        "2.3.10.11": [
            "Network access: Restrict clients allowed to make remote calls to SAM"
        ],
        "2.3.10.12": [
            "Network access: Shares that can be accessed anonymously"
        ],
        "2.3.10.13": [
            "Network access: Sharing and security model for local accounts"
        ],
        "2.3.11.1": [
            "Network security: Allow Local System to use computer identity for NTLM"
        ],
        "2.3.11.2": [
            "Network security: Allow LocalSystem NULL session fallback"
        ],
        "2.3.11.3": [
            "Network Security: Allow PKU2U authentication requests to this computer to use online identities"
        ],
        "2.3.11.4": [
            "Network security: Configure encryption types allowed for Kerberos"
        ],
        "2.3.11.5": [
            "Network security: Force logoff when logon hours expire"
        ],
        "2.3.11.6": [
            "Network security: LAN Manager authentication level"
        ],
        "2.3.11.7": [
            "Network security: LDAP client encryption requirements"
        ],
        "2.3.11.8": [
            "Network security: LDAP client signing requirements"
        ],
        "2.3.11.9": [
            "Network security: Minimum session security for NTLM SSP based (including secure RPC) clients"
        ],
        "2.3.11.10": [
            "Network security: Minimum session security for NTLM SSP based (including secure RPC) servers"
        ],
        "2.3.11.11": [
            "Network security: Restrict NTLM: Audit Incoming NTLM Traffic"
        ],
        "2.3.11.12": [
            "Network security: Restrict NTLM: Audit NTLM authentication in this domain"
        ],
        "2.3.11.13": [
            "Network security: Restrict NTLM: Outgoing NTLM traffic to remote servers"
        ],
        "2.3.13.1": [
            "Shutdown: Allow system to be shut down without having to log on"
        ],
        "2.3.15.1": [
            "System objects: Require case insensitivity for non-Windows subsystems"
        ],
        "2.3.15.2": [
            "System objects: Strengthen default permissions of internal system objects (e.g. Symbolic Links)"
        ],
        "2.3.17.1": [
            "User Account Control: Admin Approval Mode for the Built-in Administrator account"
        ],
        "2.3.17.2": [
            "User Account Control: Behavior of the elevation prompt for administrators in Admin Approval Mode"
        ],
        "2.3.17.3": [
            "User Account Control: Behavior of the elevation prompt for standard users"
        ],
        "2.3.17.4": [
            "User Account Control: Detect application installations and prompt for elevation"
        ],
        "2.3.17.5": [
            "User Account Control: Only elevate UIAccess applications that are installed in secure locations"
        ],
        "2.3.17.6": [
            "User Account Control: Run all administrators in Admin Approval Mode"
        ],
        "2.3.17.7": [
            "User Account Control: Switch to the secure desktop when prompting for elevation"
        ],
        "2.3.17.8": [
            "User Account Control: Virtualize file and registry write failures to per-user locations"
        ]
    }
};

  function applyBaselineSettingMappings(catalog) {
    let mappedRecommendations = 0;
    let mappedNames = new Set();
    (catalog.benchmarks || []).forEach(benchmark => {
      const byRequirement = BASELINE_SETTING_MAPPINGS[benchmark.id] || {};
      (benchmark.recommendations || []).forEach(recommendation => {
        const settingKeys = byRequirement[String(recommendation.requirementNumber)];
        if (!settingKeys) return;
        recommendation.settingKeys = settingKeys.slice();
        recommendation.mapping = {
          type: 'verified-baseline-setting',
          settingKeys: settingKeys.slice()
        };
        recommendation.status = 'catalog_only';
        recommendation.status = 'mapped';
        recommendation.mappingStatus = 'exact-name';
        mappedRecommendations++;
        mappedNames.add(String(recommendation.requirementNumber));
      });
    });
    return { mappedRecommendations, mappedNames: Array.from(mappedNames).sort() };
  }

  // V5.2 Mapping C1: Administrative Templates cross-verified against the real
  // Microsoft Windows 11 v25H2 baseline gpreport.xml. This is evidence of
  // an exact Category + Name match in a real GPO report, not a claim that
  // the CIS server recommendation is universally applicable to every server.
  const ADMIN_TEMPLATE_CROSS_BASELINE_MAPPINGS = {
    "windows-server-2019": {
        "18.1.1.1": {
            "settingKey": "Control Panel/Personalization > Prevent enabling lock screen camera",
            "name": "Prevent enabling lock screen camera",
            "category": "Control Panel/Personalization",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.1.1.2": {
            "settingKey": "Control Panel/Personalization > Prevent enabling lock screen slide show",
            "name": "Prevent enabling lock screen slide show",
            "category": "Control Panel/Personalization",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.1": {
            "settingKey": "MS Security Guide > Apply UAC restrictions to local accounts on network logons",
            "name": "Apply UAC restrictions to local accounts on network logons",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.2": {
            "settingKey": "MS Security Guide > Configure SMB v1 client driver",
            "name": "Configure SMB v1 client driver",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.3": {
            "settingKey": "MS Security Guide > Configure SMB v1 server",
            "name": "Configure SMB v1 server",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.5": {
            "settingKey": "MS Security Guide > Enable Structured Exception Handling Overwrite Protection (SEHOP)",
            "name": "Enable Structured Exception Handling Overwrite Protection (SEHOP)",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.6": {
            "settingKey": "MS Security Guide > LSA Protection",
            "name": "LSA Protection",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.7": {
            "settingKey": "MS Security Guide > NetBT NodeType configuration",
            "name": "NetBT NodeType configuration",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.2": {
            "settingKey": "MSS (Legacy) > MSS: (DisableIPSourceRouting IPv6) IP source routing protection level",
            "name": "MSS: (DisableIPSourceRouting IPv6) IP source routing protection level",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.3": {
            "settingKey": "MSS (Legacy) > MSS: (DisableIPSourceRouting) IP source routing protection level",
            "name": "MSS: (DisableIPSourceRouting) IP source routing protection level",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.4": {
            "settingKey": "MSS (Legacy) > MSS: (EnableICMPRedirect) Allow ICMP redirects to override OSPF generated routes",
            "name": "MSS: (EnableICMPRedirect) Allow ICMP redirects to override OSPF generated routes",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.6": {
            "settingKey": "MSS (Legacy) > MSS: (NoNameReleaseOnDemand) Allow the computer to ignore NetBIOS name release requests except from WINS servers",
            "name": "MSS: (NoNameReleaseOnDemand) Allow the computer to ignore NetBIOS name release requests except from WINS servers",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.4.2": {
            "settingKey": "Network/DNS Client > Configure NetBIOS settings",
            "name": "Configure NetBIOS settings",
            "category": "Network/DNS Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.4.4": {
            "settingKey": "Network/DNS Client > Turn off multicast name resolution",
            "name": "Turn off multicast name resolution",
            "category": "Network/DNS Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.8.1": {
            "settingKey": "Network/Lanman Workstation > Enable insecure guest logons",
            "name": "Enable insecure guest logons",
            "category": "Network/Lanman Workstation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.11.3": {
            "settingKey": "Network/Network Connections > Prohibit use of Internet Connection Sharing on your DNS domain network",
            "name": "Prohibit use of Internet Connection Sharing on your DNS domain network",
            "category": "Network/Network Connections",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.14.1": {
            "settingKey": "Network/Network Provider > Hardened UNC Paths",
            "name": "Hardened UNC Paths",
            "category": "Network/Network Provider",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.21.2": {
            "settingKey": "Network/Windows Connection Manager > Prohibit connection to non-domain networks when connected to domain authenticated network",
            "name": "Prohibit connection to non-domain networks when connected to domain authenticated network",
            "category": "Network/Windows Connection Manager",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.2": {
            "settingKey": "Printers > Configure Redirection Guard",
            "name": "Configure Redirection Guard",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.7": {
            "settingKey": "Printers > Configure RPC over TCP port",
            "name": "Configure RPC over TCP port",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.8": {
            "settingKey": "Printers > Configure RPC packet level privacy setting for incoming connections",
            "name": "Configure RPC packet level privacy setting for incoming connections",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.9": {
            "settingKey": "Printers > Limits print driver installation to Administrators",
            "name": "Limits print driver installation to Administrators",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.10": {
            "settingKey": "Printers > Manage processing of Queue-specific files",
            "name": "Manage processing of Queue-specific files",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.3.1": {
            "settingKey": "System/Audit Process Creation > Include command line in process creation events",
            "name": "Include command line in process creation events",
            "category": "System/Audit Process Creation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.4.1": {
            "settingKey": "System/Credentials Delegation > Encryption Oracle Remediation",
            "name": "Encryption Oracle Remediation",
            "category": "System/Credentials Delegation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.4.2": {
            "settingKey": "System/Credentials Delegation > Remote host allows delegation of non-exportable credentials",
            "name": "Remote host allows delegation of non-exportable credentials",
            "category": "System/Credentials Delegation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.5.1": {
            "settingKey": "System/Device Guard > Turn On Virtualization Based Security",
            "name": "Turn On Virtualization Based Security",
            "category": "System/Device Guard",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.13.1": {
            "settingKey": "System/Early Launch Antimalware > Boot-Start Driver Initialization Policy",
            "name": "Boot-Start Driver Initialization Policy",
            "category": "System/Early Launch Antimalware",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.20.1.1": {
            "settingKey": "System/Internet Communication Management/Internet Communication settings > Turn off downloading of print drivers over HTTP",
            "name": "Turn off downloading of print drivers over HTTP",
            "category": "System/Internet Communication Management/Internet Communication settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.20.1.5": {
            "settingKey": "System/Internet Communication Management/Internet Communication settings > Turn off Internet download for Web publishing and online ordering wizards",
            "name": "Turn off Internet download for Web publishing and online ordering wizards",
            "category": "System/Internet Communication Management/Internet Communication settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.24.1": {
            "settingKey": "System/Kernel DMA Protection > Enumeration policy for external devices incompatible with Kernel DMA Protection",
            "name": "Enumeration policy for external devices incompatible with Kernel DMA Protection",
            "category": "System/Kernel DMA Protection",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.26.1": {
            "settingKey": "System/LAPS > Configure password backup directory",
            "name": "Configure password backup directory",
            "category": "System/LAPS",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.26.3": {
            "settingKey": "System/LAPS > Enable password encryption",
            "name": "Enable password encryption",
            "category": "System/LAPS",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.29.4": {
            "settingKey": "System/Logon > Enumerate local users on domain-joined computers",
            "name": "Enumerate local users on domain-joined computers",
            "category": "System/Logon",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.29.6": {
            "settingKey": "System/Logon > Turn on convenience PIN sign-in",
            "name": "Turn on convenience PIN sign-in",
            "category": "System/Logon",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.35.6.3": {
            "settingKey": "System/Power Management/Sleep Settings > Require a password when a computer wakes (on battery)",
            "name": "Require a password when a computer wakes (on battery)",
            "category": "System/Power Management/Sleep Settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.35.6.4": {
            "settingKey": "System/Power Management/Sleep Settings > Require a password when a computer wakes (plugged in)",
            "name": "Require a password when a computer wakes (plugged in)",
            "category": "System/Power Management/Sleep Settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.37.2": {
            "settingKey": "System/Remote Assistance > Configure Solicited Remote Assistance",
            "name": "Configure Solicited Remote Assistance",
            "category": "System/Remote Assistance",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.38.2": {
            "settingKey": "System/Remote Procedure Call > Restrict Unauthenticated RPC clients",
            "name": "Restrict Unauthenticated RPC clients",
            "category": "System/Remote Procedure Call",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.6.1": {
            "settingKey": "Windows Components/App runtime > Allow Microsoft accounts to be optional",
            "name": "Allow Microsoft accounts to be optional",
            "category": "Windows Components/App runtime",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.8.1": {
            "settingKey": "Windows Components/AutoPlay Policies > Disallow Autoplay for non-volume devices",
            "name": "Disallow Autoplay for non-volume devices",
            "category": "Windows Components/AutoPlay Policies",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.8.2": {
            "settingKey": "Windows Components/AutoPlay Policies > Set the default behavior for AutoRun",
            "name": "Set the default behavior for AutoRun",
            "category": "Windows Components/AutoPlay Policies",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.8.3": {
            "settingKey": "Windows Components/AutoPlay Policies > Turn off Autoplay",
            "name": "Turn off Autoplay",
            "category": "Windows Components/AutoPlay Policies",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.9.1.1": {
            "settingKey": "Windows Components/Biometrics/Facial Features > Configure enhanced anti-spoofing",
            "name": "Configure enhanced anti-spoofing",
            "category": "Windows Components/Biometrics/Facial Features",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.15.2": {
            "settingKey": "Windows Components/Credential User Interface > Enumerate administrator accounts on elevation",
            "name": "Enumerate administrator accounts on elevation",
            "category": "Windows Components/Credential User Interface",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.29.2": {
            "settingKey": "Windows Components/File Explorer > Do not apply the Mark of the Web tag to files copied from insecure sources",
            "name": "Do not apply the Mark of the Web tag to files copied from insecure sources",
            "category": "Windows Components/File Explorer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.2.2": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Connection Client > Do not allow passwords to be saved",
            "name": "Do not allow passwords to be saved",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Connection Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.3.2": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Device and Resource Redirection > Do not allow drive redirection",
            "name": "Do not allow drive redirection",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Device and Resource Redirection",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.9.1": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security > Always prompt for password upon connection",
            "name": "Always prompt for password upon connection",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.9.2": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security > Require secure RPC communication",
            "name": "Require secure RPC communication",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.9.5": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security > Set client connection encryption level",
            "name": "Set client connection encryption level",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.58.1": {
            "settingKey": "Windows Components/RSS Feeds > Prevent downloading of enclosures",
            "name": "Prevent downloading of enclosures",
            "category": "Windows Components/RSS Feeds",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.59.3": {
            "settingKey": "Windows Components/Search > Allow indexing of encrypted files",
            "name": "Allow indexing of encrypted files",
            "category": "Windows Components/Search",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.77.2.1": {
            "settingKey": "Windows Components/Windows Defender SmartScreen/Explorer > Configure Windows Defender SmartScreen",
            "name": "Configure Windows Defender SmartScreen",
            "category": "Windows Components/Windows Defender SmartScreen/Explorer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.81.2": {
            "settingKey": "Windows Components/Windows Ink Workspace > Allow Windows Ink Workspace",
            "name": "Allow Windows Ink Workspace",
            "category": "Windows Components/Windows Ink Workspace",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.82.1": {
            "settingKey": "Windows Components/Windows Installer > Allow user control over installs",
            "name": "Allow user control over installs",
            "category": "Windows Components/Windows Installer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.82.2": {
            "settingKey": "Windows Components/Windows Installer > Always install with elevated privileges",
            "name": "Always install with elevated privileges",
            "category": "Windows Components/Windows Installer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.83.1": {
            "settingKey": "Windows Components/Windows Logon Options > Sign-in and lock last interactive user automatically after a restart",
            "name": "Sign-in and lock last interactive user automatically after a restart",
            "category": "Windows Components/Windows Logon Options",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.88.1": {
            "settingKey": "Windows Components/Windows PowerShell > Turn on PowerShell Script Block Logging",
            "name": "Turn on PowerShell Script Block Logging",
            "category": "Windows Components/Windows PowerShell",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.90.1.3": {
            "settingKey": "Windows Components/Windows Remote Management (WinRM)/WinRM Client > Disallow Digest authentication",
            "name": "Disallow Digest authentication",
            "category": "Windows Components/Windows Remote Management (WinRM)/WinRM Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.90.2.4": {
            "settingKey": "Windows Components/Windows Remote Management (WinRM)/WinRM Service > Disallow WinRM from storing RunAs credentials",
            "name": "Disallow WinRM from storing RunAs credentials",
            "category": "Windows Components/Windows Remote Management (WinRM)/WinRM Service",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "19.5.1.1": {
            "settingKey": "Start Menu and Taskbar/Notifications > Turn off toast notifications on the lock screen",
            "name": "Turn off toast notifications on the lock screen",
            "category": "Start Menu and Taskbar/Notifications",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "19.7.8.2": {
            "settingKey": "Windows Components/Cloud Content > Do not suggest third-party content in Windows spotlight",
            "name": "Do not suggest third-party content in Windows spotlight",
            "category": "Windows Components/Cloud Content",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        }
    },
    "windows-server-2022": {
        "18.1.1.1": {
            "settingKey": "Control Panel/Personalization > Prevent enabling lock screen camera",
            "name": "Prevent enabling lock screen camera",
            "category": "Control Panel/Personalization",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.1.1.2": {
            "settingKey": "Control Panel/Personalization > Prevent enabling lock screen slide show",
            "name": "Prevent enabling lock screen slide show",
            "category": "Control Panel/Personalization",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.1": {
            "settingKey": "MS Security Guide > Apply UAC restrictions to local accounts on network logons",
            "name": "Apply UAC restrictions to local accounts on network logons",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.2": {
            "settingKey": "MS Security Guide > Configure SMB v1 client driver",
            "name": "Configure SMB v1 client driver",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.3": {
            "settingKey": "MS Security Guide > Configure SMB v1 server",
            "name": "Configure SMB v1 server",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.5": {
            "settingKey": "MS Security Guide > Enable Structured Exception Handling Overwrite Protection (SEHOP)",
            "name": "Enable Structured Exception Handling Overwrite Protection (SEHOP)",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.6": {
            "settingKey": "MS Security Guide > NetBT NodeType configuration",
            "name": "NetBT NodeType configuration",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.2": {
            "settingKey": "MSS (Legacy) > MSS: (DisableIPSourceRouting IPv6) IP source routing protection level",
            "name": "MSS: (DisableIPSourceRouting IPv6) IP source routing protection level",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.3": {
            "settingKey": "MSS (Legacy) > MSS: (DisableIPSourceRouting) IP source routing protection level",
            "name": "MSS: (DisableIPSourceRouting) IP source routing protection level",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.4": {
            "settingKey": "MSS (Legacy) > MSS: (EnableICMPRedirect) Allow ICMP redirects to override OSPF generated routes",
            "name": "MSS: (EnableICMPRedirect) Allow ICMP redirects to override OSPF generated routes",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.6": {
            "settingKey": "MSS (Legacy) > MSS: (NoNameReleaseOnDemand) Allow the computer to ignore NetBIOS name release requests except from WINS servers",
            "name": "MSS: (NoNameReleaseOnDemand) Allow the computer to ignore NetBIOS name release requests except from WINS servers",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.4.2": {
            "settingKey": "Network/DNS Client > Configure NetBIOS settings",
            "name": "Configure NetBIOS settings",
            "category": "Network/DNS Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.4.4": {
            "settingKey": "Network/DNS Client > Turn off multicast name resolution",
            "name": "Turn off multicast name resolution",
            "category": "Network/DNS Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.8.1": {
            "settingKey": "Network/Lanman Workstation > Enable insecure guest logons",
            "name": "Enable insecure guest logons",
            "category": "Network/Lanman Workstation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.8.2": {
            "settingKey": "Network/Lanman Workstation > Require Encryption",
            "name": "Require Encryption",
            "category": "Network/Lanman Workstation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.11.3": {
            "settingKey": "Network/Network Connections > Prohibit use of Internet Connection Sharing on your DNS domain network",
            "name": "Prohibit use of Internet Connection Sharing on your DNS domain network",
            "category": "Network/Network Connections",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.14.1": {
            "settingKey": "Network/Network Provider > Hardened UNC Paths",
            "name": "Hardened UNC Paths",
            "category": "Network/Network Provider",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.21.2": {
            "settingKey": "Network/Windows Connection Manager > Prohibit connection to non-domain networks when connected to domain authenticated network",
            "name": "Prohibit connection to non-domain networks when connected to domain authenticated network",
            "category": "Network/Windows Connection Manager",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.2": {
            "settingKey": "Printers > Configure Redirection Guard",
            "name": "Configure Redirection Guard",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.7": {
            "settingKey": "Printers > Configure RPC over TCP port",
            "name": "Configure RPC over TCP port",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.8": {
            "settingKey": "Printers > Configure RPC packet level privacy setting for incoming connections",
            "name": "Configure RPC packet level privacy setting for incoming connections",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.9": {
            "settingKey": "Printers > Limits print driver installation to Administrators",
            "name": "Limits print driver installation to Administrators",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.10": {
            "settingKey": "Printers > Manage processing of Queue-specific files",
            "name": "Manage processing of Queue-specific files",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.3.1": {
            "settingKey": "System/Audit Process Creation > Include command line in process creation events",
            "name": "Include command line in process creation events",
            "category": "System/Audit Process Creation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.4.1": {
            "settingKey": "System/Credentials Delegation > Encryption Oracle Remediation",
            "name": "Encryption Oracle Remediation",
            "category": "System/Credentials Delegation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.4.2": {
            "settingKey": "System/Credentials Delegation > Remote host allows delegation of non-exportable credentials",
            "name": "Remote host allows delegation of non-exportable credentials",
            "category": "System/Credentials Delegation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.5.1": {
            "settingKey": "System/Device Guard > Turn On Virtualization Based Security",
            "name": "Turn On Virtualization Based Security",
            "category": "System/Device Guard",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.13.1": {
            "settingKey": "System/Early Launch Antimalware > Boot-Start Driver Initialization Policy",
            "name": "Boot-Start Driver Initialization Policy",
            "category": "System/Early Launch Antimalware",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.20.1.1": {
            "settingKey": "System/Internet Communication Management/Internet Communication settings > Turn off downloading of print drivers over HTTP",
            "name": "Turn off downloading of print drivers over HTTP",
            "category": "System/Internet Communication Management/Internet Communication settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.20.1.5": {
            "settingKey": "System/Internet Communication Management/Internet Communication settings > Turn off Internet download for Web publishing and online ordering wizards",
            "name": "Turn off Internet download for Web publishing and online ordering wizards",
            "category": "System/Internet Communication Management/Internet Communication settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.24.1": {
            "settingKey": "System/Kernel DMA Protection > Enumeration policy for external devices incompatible with Kernel DMA Protection",
            "name": "Enumeration policy for external devices incompatible with Kernel DMA Protection",
            "category": "System/Kernel DMA Protection",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.26.1": {
            "settingKey": "System/LAPS > Configure password backup directory",
            "name": "Configure password backup directory",
            "category": "System/LAPS",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.26.3": {
            "settingKey": "System/LAPS > Enable password encryption",
            "name": "Enable password encryption",
            "category": "System/LAPS",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.27.1": {
            "settingKey": "System/Local Security Authority > Allow Custom SSPs and APs to be loaded into LSASS",
            "name": "Allow Custom SSPs and APs to be loaded into LSASS",
            "category": "System/Local Security Authority",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.27.2": {
            "settingKey": "System/Local Security Authority > Configures LSASS to run as a protected process",
            "name": "Configures LSASS to run as a protected process",
            "category": "System/Local Security Authority",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.29.4": {
            "settingKey": "System/Logon > Enumerate local users on domain-joined computers",
            "name": "Enumerate local users on domain-joined computers",
            "category": "System/Logon",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.29.6": {
            "settingKey": "System/Logon > Turn on convenience PIN sign-in",
            "name": "Turn on convenience PIN sign-in",
            "category": "System/Logon",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.35.6.3": {
            "settingKey": "System/Power Management/Sleep Settings > Require a password when a computer wakes (on battery)",
            "name": "Require a password when a computer wakes (on battery)",
            "category": "System/Power Management/Sleep Settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.35.6.4": {
            "settingKey": "System/Power Management/Sleep Settings > Require a password when a computer wakes (plugged in)",
            "name": "Require a password when a computer wakes (plugged in)",
            "category": "System/Power Management/Sleep Settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.37.2": {
            "settingKey": "System/Remote Assistance > Configure Solicited Remote Assistance",
            "name": "Configure Solicited Remote Assistance",
            "category": "System/Remote Assistance",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.38.2": {
            "settingKey": "System/Remote Procedure Call > Restrict Unauthenticated RPC clients",
            "name": "Restrict Unauthenticated RPC clients",
            "category": "System/Remote Procedure Call",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.6.1": {
            "settingKey": "Windows Components/App runtime > Allow Microsoft accounts to be optional",
            "name": "Allow Microsoft accounts to be optional",
            "category": "Windows Components/App runtime",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.8.1": {
            "settingKey": "Windows Components/AutoPlay Policies > Disallow Autoplay for non-volume devices",
            "name": "Disallow Autoplay for non-volume devices",
            "category": "Windows Components/AutoPlay Policies",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.8.2": {
            "settingKey": "Windows Components/AutoPlay Policies > Set the default behavior for AutoRun",
            "name": "Set the default behavior for AutoRun",
            "category": "Windows Components/AutoPlay Policies",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.8.3": {
            "settingKey": "Windows Components/AutoPlay Policies > Turn off Autoplay",
            "name": "Turn off Autoplay",
            "category": "Windows Components/AutoPlay Policies",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.9.1.1": {
            "settingKey": "Windows Components/Biometrics/Facial Features > Configure enhanced anti-spoofing",
            "name": "Configure enhanced anti-spoofing",
            "category": "Windows Components/Biometrics/Facial Features",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.15.2": {
            "settingKey": "Windows Components/Credential User Interface > Enumerate administrator accounts on elevation",
            "name": "Enumerate administrator accounts on elevation",
            "category": "Windows Components/Credential User Interface",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.29.2": {
            "settingKey": "Windows Components/File Explorer > Do not apply the Mark of the Web tag to files copied from insecure sources",
            "name": "Do not apply the Mark of the Web tag to files copied from insecure sources",
            "category": "Windows Components/File Explorer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.2.2": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Connection Client > Do not allow passwords to be saved",
            "name": "Do not allow passwords to be saved",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Connection Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.3.3": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Device and Resource Redirection > Do not allow drive redirection",
            "name": "Do not allow drive redirection",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Device and Resource Redirection",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.9.1": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security > Always prompt for password upon connection",
            "name": "Always prompt for password upon connection",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.9.2": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security > Require secure RPC communication",
            "name": "Require secure RPC communication",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.9.5": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security > Set client connection encryption level",
            "name": "Set client connection encryption level",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.58.1": {
            "settingKey": "Windows Components/RSS Feeds > Prevent downloading of enclosures",
            "name": "Prevent downloading of enclosures",
            "category": "Windows Components/RSS Feeds",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.59.3": {
            "settingKey": "Windows Components/Search > Allow indexing of encrypted files",
            "name": "Allow indexing of encrypted files",
            "category": "Windows Components/Search",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.77.2.1": {
            "settingKey": "Windows Components/Windows Defender SmartScreen/Explorer > Configure Windows Defender SmartScreen",
            "name": "Configure Windows Defender SmartScreen",
            "category": "Windows Components/Windows Defender SmartScreen/Explorer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.81.2": {
            "settingKey": "Windows Components/Windows Ink Workspace > Allow Windows Ink Workspace",
            "name": "Allow Windows Ink Workspace",
            "category": "Windows Components/Windows Ink Workspace",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.82.1": {
            "settingKey": "Windows Components/Windows Installer > Allow user control over installs",
            "name": "Allow user control over installs",
            "category": "Windows Components/Windows Installer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.82.2": {
            "settingKey": "Windows Components/Windows Installer > Always install with elevated privileges",
            "name": "Always install with elevated privileges",
            "category": "Windows Components/Windows Installer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.83.2": {
            "settingKey": "Windows Components/Windows Logon Options > Sign-in and lock last interactive user automatically after a restart",
            "name": "Sign-in and lock last interactive user automatically after a restart",
            "category": "Windows Components/Windows Logon Options",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.88.1": {
            "settingKey": "Windows Components/Windows PowerShell > Turn on PowerShell Script Block Logging",
            "name": "Turn on PowerShell Script Block Logging",
            "category": "Windows Components/Windows PowerShell",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.90.1.3": {
            "settingKey": "Windows Components/Windows Remote Management (WinRM)/WinRM Client > Disallow Digest authentication",
            "name": "Disallow Digest authentication",
            "category": "Windows Components/Windows Remote Management (WinRM)/WinRM Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.90.2.4": {
            "settingKey": "Windows Components/Windows Remote Management (WinRM)/WinRM Service > Disallow WinRM from storing RunAs credentials",
            "name": "Disallow WinRM from storing RunAs credentials",
            "category": "Windows Components/Windows Remote Management (WinRM)/WinRM Service",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "19.5.1.1": {
            "settingKey": "Start Menu and Taskbar/Notifications > Turn off toast notifications on the lock screen",
            "name": "Turn off toast notifications on the lock screen",
            "category": "Start Menu and Taskbar/Notifications",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "19.7.8.2": {
            "settingKey": "Windows Components/Cloud Content > Do not suggest third-party content in Windows spotlight",
            "name": "Do not suggest third-party content in Windows spotlight",
            "category": "Windows Components/Cloud Content",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        }
    },
    "windows-server-2025": {
        "18.1.1.1": {
            "settingKey": "Control Panel/Personalization > Prevent enabling lock screen camera",
            "name": "Prevent enabling lock screen camera",
            "category": "Control Panel/Personalization",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.1.1.2": {
            "settingKey": "Control Panel/Personalization > Prevent enabling lock screen slide show",
            "name": "Prevent enabling lock screen slide show",
            "category": "Control Panel/Personalization",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.1": {
            "settingKey": "MS Security Guide > Apply UAC restrictions to local accounts on network logons",
            "name": "Apply UAC restrictions to local accounts on network logons",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.2": {
            "settingKey": "MS Security Guide > Configure SMB v1 client driver",
            "name": "Configure SMB v1 client driver",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.3": {
            "settingKey": "MS Security Guide > Configure SMB v1 server",
            "name": "Configure SMB v1 server",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.5": {
            "settingKey": "MS Security Guide > Enable Structured Exception Handling Overwrite Protection (SEHOP)",
            "name": "Enable Structured Exception Handling Overwrite Protection (SEHOP)",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.4.6": {
            "settingKey": "MS Security Guide > NetBT NodeType configuration",
            "name": "NetBT NodeType configuration",
            "category": "MS Security Guide",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.2": {
            "settingKey": "MSS (Legacy) > MSS: (DisableIPSourceRouting IPv6) IP source routing protection level",
            "name": "MSS: (DisableIPSourceRouting IPv6) IP source routing protection level",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.3": {
            "settingKey": "MSS (Legacy) > MSS: (DisableIPSourceRouting) IP source routing protection level",
            "name": "MSS: (DisableIPSourceRouting) IP source routing protection level",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.4": {
            "settingKey": "MSS (Legacy) > MSS: (EnableICMPRedirect) Allow ICMP redirects to override OSPF generated routes",
            "name": "MSS: (EnableICMPRedirect) Allow ICMP redirects to override OSPF generated routes",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.5.6": {
            "settingKey": "MSS (Legacy) > MSS: (NoNameReleaseOnDemand) Allow the computer to ignore NetBIOS name release requests except from WINS servers",
            "name": "MSS: (NoNameReleaseOnDemand) Allow the computer to ignore NetBIOS name release requests except from WINS servers",
            "category": "MSS (Legacy)",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.4.2": {
            "settingKey": "Network/DNS Client > Configure NetBIOS settings",
            "name": "Configure NetBIOS settings",
            "category": "Network/DNS Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.4.4": {
            "settingKey": "Network/DNS Client > Turn off multicast name resolution",
            "name": "Turn off multicast name resolution",
            "category": "Network/DNS Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.7.1": {
            "settingKey": "Network/Lanman Server > Audit client does not support encryption",
            "name": "Audit client does not support encryption",
            "category": "Network/Lanman Server",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.7.2": {
            "settingKey": "Network/Lanman Server > Audit client does not support signing",
            "name": "Audit client does not support signing",
            "category": "Network/Lanman Server",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.7.4": {
            "settingKey": "Network/Lanman Server > Enable authentication rate limiter",
            "name": "Enable authentication rate limiter",
            "category": "Network/Lanman Server",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.7.7": {
            "settingKey": "Network/Lanman Server > Set authentication rate limiter delay (milliseconds)",
            "name": "Set authentication rate limiter delay (milliseconds)",
            "category": "Network/Lanman Server",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.8.2": {
            "settingKey": "Network/Lanman Workstation > Audit server does not support encryption",
            "name": "Audit server does not support encryption",
            "category": "Network/Lanman Workstation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.8.3": {
            "settingKey": "Network/Lanman Workstation > Audit server does not support signing",
            "name": "Audit server does not support signing",
            "category": "Network/Lanman Workstation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.8.4": {
            "settingKey": "Network/Lanman Workstation > Enable insecure guest logons",
            "name": "Enable insecure guest logons",
            "category": "Network/Lanman Workstation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.8.7": {
            "settingKey": "Network/Lanman Workstation > Require Encryption",
            "name": "Require Encryption",
            "category": "Network/Lanman Workstation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.11.3": {
            "settingKey": "Network/Network Connections > Prohibit use of Internet Connection Sharing on your DNS domain network",
            "name": "Prohibit use of Internet Connection Sharing on your DNS domain network",
            "category": "Network/Network Connections",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.14.1": {
            "settingKey": "Network/Network Provider > Hardened UNC Paths",
            "name": "Hardened UNC Paths",
            "category": "Network/Network Provider",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.6.21.2": {
            "settingKey": "Network/Windows Connection Manager > Prohibit connection to non-domain networks when connected to domain authenticated network",
            "name": "Prohibit connection to non-domain networks when connected to domain authenticated network",
            "category": "Network/Windows Connection Manager",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.2": {
            "settingKey": "Printers > Configure Redirection Guard",
            "name": "Configure Redirection Guard",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.7": {
            "settingKey": "Printers > Configure RPC over TCP port",
            "name": "Configure RPC over TCP port",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.8": {
            "settingKey": "Printers > Configure RPC packet level privacy setting for incoming connections",
            "name": "Configure RPC packet level privacy setting for incoming connections",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.10": {
            "settingKey": "Printers > Limits print driver installation to Administrators",
            "name": "Limits print driver installation to Administrators",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.7.11": {
            "settingKey": "Printers > Manage processing of Queue-specific files",
            "name": "Manage processing of Queue-specific files",
            "category": "Printers",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.3.1": {
            "settingKey": "System/Audit Process Creation > Include command line in process creation events",
            "name": "Include command line in process creation events",
            "category": "System/Audit Process Creation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.4.1": {
            "settingKey": "System/Credentials Delegation > Encryption Oracle Remediation",
            "name": "Encryption Oracle Remediation",
            "category": "System/Credentials Delegation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.4.2": {
            "settingKey": "System/Credentials Delegation > Remote host allows delegation of non-exportable credentials",
            "name": "Remote host allows delegation of non-exportable credentials",
            "category": "System/Credentials Delegation",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.5.1": {
            "settingKey": "System/Device Guard > Turn On Virtualization Based Security",
            "name": "Turn On Virtualization Based Security",
            "category": "System/Device Guard",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.13.1": {
            "settingKey": "System/Early Launch Antimalware > Boot-Start Driver Initialization Policy",
            "name": "Boot-Start Driver Initialization Policy",
            "category": "System/Early Launch Antimalware",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.20.1.1": {
            "settingKey": "System/Internet Communication Management/Internet Communication settings > Turn off downloading of print drivers over HTTP",
            "name": "Turn off downloading of print drivers over HTTP",
            "category": "System/Internet Communication Management/Internet Communication settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.20.1.5": {
            "settingKey": "System/Internet Communication Management/Internet Communication settings > Turn off Internet download for Web publishing and online ordering wizards",
            "name": "Turn off Internet download for Web publishing and online ordering wizards",
            "category": "System/Internet Communication Management/Internet Communication settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.24.1": {
            "settingKey": "System/Kernel DMA Protection > Enumeration policy for external devices incompatible with Kernel DMA Protection",
            "name": "Enumeration policy for external devices incompatible with Kernel DMA Protection",
            "category": "System/Kernel DMA Protection",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.26.1": {
            "settingKey": "System/LAPS > Configure password backup directory",
            "name": "Configure password backup directory",
            "category": "System/LAPS",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.26.3": {
            "settingKey": "System/LAPS > Enable password encryption",
            "name": "Enable password encryption",
            "category": "System/LAPS",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.27.1": {
            "settingKey": "System/Local Security Authority > Allow Custom SSPs and APs to be loaded into LSASS",
            "name": "Allow Custom SSPs and APs to be loaded into LSASS",
            "category": "System/Local Security Authority",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.27.2": {
            "settingKey": "System/Local Security Authority > Configures LSASS to run as a protected process",
            "name": "Configures LSASS to run as a protected process",
            "category": "System/Local Security Authority",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.29.4": {
            "settingKey": "System/Logon > Enumerate local users on domain-joined computers",
            "name": "Enumerate local users on domain-joined computers",
            "category": "System/Logon",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.29.6": {
            "settingKey": "System/Logon > Turn on convenience PIN sign-in",
            "name": "Turn on convenience PIN sign-in",
            "category": "System/Logon",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.35.6.3": {
            "settingKey": "System/Power Management/Sleep Settings > Require a password when a computer wakes (on battery)",
            "name": "Require a password when a computer wakes (on battery)",
            "category": "System/Power Management/Sleep Settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.35.6.4": {
            "settingKey": "System/Power Management/Sleep Settings > Require a password when a computer wakes (plugged in)",
            "name": "Require a password when a computer wakes (plugged in)",
            "category": "System/Power Management/Sleep Settings",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.37.2": {
            "settingKey": "System/Remote Assistance > Configure Solicited Remote Assistance",
            "name": "Configure Solicited Remote Assistance",
            "category": "System/Remote Assistance",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.9.38.2": {
            "settingKey": "System/Remote Procedure Call > Restrict Unauthenticated RPC clients",
            "name": "Restrict Unauthenticated RPC clients",
            "category": "System/Remote Procedure Call",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.6.1": {
            "settingKey": "Windows Components/App runtime > Allow Microsoft accounts to be optional",
            "name": "Allow Microsoft accounts to be optional",
            "category": "Windows Components/App runtime",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.8.1": {
            "settingKey": "Windows Components/AutoPlay Policies > Disallow Autoplay for non-volume devices",
            "name": "Disallow Autoplay for non-volume devices",
            "category": "Windows Components/AutoPlay Policies",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.8.2": {
            "settingKey": "Windows Components/AutoPlay Policies > Set the default behavior for AutoRun",
            "name": "Set the default behavior for AutoRun",
            "category": "Windows Components/AutoPlay Policies",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.8.3": {
            "settingKey": "Windows Components/AutoPlay Policies > Turn off Autoplay",
            "name": "Turn off Autoplay",
            "category": "Windows Components/AutoPlay Policies",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.9.1.1": {
            "settingKey": "Windows Components/Biometrics/Facial Features > Configure enhanced anti-spoofing",
            "name": "Configure enhanced anti-spoofing",
            "category": "Windows Components/Biometrics/Facial Features",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.15.2": {
            "settingKey": "Windows Components/Credential User Interface > Enumerate administrator accounts on elevation",
            "name": "Enumerate administrator accounts on elevation",
            "category": "Windows Components/Credential User Interface",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.29.2": {
            "settingKey": "Windows Components/File Explorer > Do not apply the Mark of the Web tag to files copied from insecure sources",
            "name": "Do not apply the Mark of the Web tag to files copied from insecure sources",
            "category": "Windows Components/File Explorer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.2.2": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Connection Client > Do not allow passwords to be saved",
            "name": "Do not allow passwords to be saved",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Connection Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.3.3": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Device and Resource Redirection > Do not allow drive redirection",
            "name": "Do not allow drive redirection",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Device and Resource Redirection",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.9.1": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security > Always prompt for password upon connection",
            "name": "Always prompt for password upon connection",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.9.2": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security > Require secure RPC communication",
            "name": "Require secure RPC communication",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.57.3.9.5": {
            "settingKey": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security > Set client connection encryption level",
            "name": "Set client connection encryption level",
            "category": "Windows Components/Remote Desktop Services/Remote Desktop Session Host/Security",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.58.1": {
            "settingKey": "Windows Components/RSS Feeds > Prevent downloading of enclosures",
            "name": "Prevent downloading of enclosures",
            "category": "Windows Components/RSS Feeds",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.59.3": {
            "settingKey": "Windows Components/Search > Allow indexing of encrypted files",
            "name": "Allow indexing of encrypted files",
            "category": "Windows Components/Search",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.77.2.1": {
            "settingKey": "Windows Components/Windows Defender SmartScreen/Explorer > Configure Windows Defender SmartScreen",
            "name": "Configure Windows Defender SmartScreen",
            "category": "Windows Components/Windows Defender SmartScreen/Explorer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.81.2": {
            "settingKey": "Windows Components/Windows Ink Workspace > Allow Windows Ink Workspace",
            "name": "Allow Windows Ink Workspace",
            "category": "Windows Components/Windows Ink Workspace",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.82.1": {
            "settingKey": "Windows Components/Windows Installer > Allow user control over installs",
            "name": "Allow user control over installs",
            "category": "Windows Components/Windows Installer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.82.2": {
            "settingKey": "Windows Components/Windows Installer > Always install with elevated privileges",
            "name": "Always install with elevated privileges",
            "category": "Windows Components/Windows Installer",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.83.2": {
            "settingKey": "Windows Components/Windows Logon Options > Sign-in and lock last interactive user automatically after a restart",
            "name": "Sign-in and lock last interactive user automatically after a restart",
            "category": "Windows Components/Windows Logon Options",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.88.1": {
            "settingKey": "Windows Components/Windows PowerShell > Turn on PowerShell Script Block Logging",
            "name": "Turn on PowerShell Script Block Logging",
            "category": "Windows Components/Windows PowerShell",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.90.1.3": {
            "settingKey": "Windows Components/Windows Remote Management (WinRM)/WinRM Client > Disallow Digest authentication",
            "name": "Disallow Digest authentication",
            "category": "Windows Components/Windows Remote Management (WinRM)/WinRM Client",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "18.10.90.2.4": {
            "settingKey": "Windows Components/Windows Remote Management (WinRM)/WinRM Service > Disallow WinRM from storing RunAs credentials",
            "name": "Disallow WinRM from storing RunAs credentials",
            "category": "Windows Components/Windows Remote Management (WinRM)/WinRM Service",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "19.5.1.1": {
            "settingKey": "Start Menu and Taskbar/Notifications > Turn off toast notifications on the lock screen",
            "name": "Turn off toast notifications on the lock screen",
            "category": "Start Menu and Taskbar/Notifications",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        },
        "19.7.8.2": {
            "settingKey": "Windows Components/Cloud Content > Do not suggest third-party content in Windows spotlight",
            "name": "Do not suggest third-party content in Windows spotlight",
            "category": "Windows Components/Cloud Content",
            "evidence": "Microsoft Windows 11 v25H2 Security Baseline gpreport.xml",
            "mappingStatus": "cross-baseline-verified"
        }
    }
};

  function applyAdministrativeTemplateCrossBaselineMappings(catalog) {
    let mappedRecommendations = 0;
    const byBenchmark = {};
    (catalog.benchmarks || []).forEach(benchmark => {
      const mappings = ADMIN_TEMPLATE_CROSS_BASELINE_MAPPINGS[benchmark.id] || {};
      let count = 0;
      (benchmark.recommendations || []).forEach(recommendation => {
        const mapping = mappings[String(recommendation.requirementNumber)];
        if (!mapping) return;
        recommendation.settingKeys = [mapping.settingKey];
        recommendation.mappingStatus = 'cross-baseline-verified';
        recommendation.mappingEvidence = mapping.evidence;
        recommendation.mapping = {
          type: 'cross-baseline-verified',
          category: mapping.category,
          name: mapping.name,
          settingKey: mapping.settingKey
        };
        count++;
        mappedRecommendations++;
      });
      byBenchmark[benchmark.id] = count;
    });
    return { mappedRecommendations, byBenchmark };
  }

  // V5.2 Mapping C: Administrative-Template candidate inventory.
  //
  // IMPORTANT: this deliberately does NOT create settingKeys. CIS titles often
  // contain a policy name but not the exact category path used by the Collector.
  // A candidate is therefore only a review hint until Category + Name have been
  // verified against a real Get-GPOReport-derived snapshot key.
  function collectAdministrativeTemplateCandidates(catalog) {
    let candidateCount = 0;
    let benchmarkCounts = {};

    (catalog.benchmarks || []).forEach(benchmark => {
      let count = 0;
      (benchmark.recommendations || []).forEach(recommendation => {
        const title = String(recommendation.title || recommendation.label || '');
        const match = title.match(/['“”"]([^'“”"]+)['“”"]/);
        if (!match) return;

        // Only inventory plausible policy-setting titles. This is intentionally
        // broad for discovery but never promotes the candidate to a settingKey.
        const looksLikePolicy =
          /\b(configure|enable|disable|set|ensure|prevent|turn off|turn on|allow|do not allow)\b/i.test(title);
        if (!looksLikePolicy) return;

        recommendation.mappingCandidate = {
          type: 'administrative-template-name-candidate',
          name: match[1],
          mappingStatus: 'needs-category-verification'
        };
        count++;
      });
      benchmarkCounts[benchmark.id] = count;
      candidateCount += count;
    });

    catalog.mappingCandidateSummary = {
      administrativeTemplateCandidates: candidateCount,
      byBenchmark: benchmarkCounts,
      note: 'Kandidaten sind nur Prüfhilfen; ohne verifizierten Category-Pfad wird kein settingKey erzeugt.'
    };
    return catalog.mappingCandidateSummary;
  }

  // V5.2 Mapping B: CIS User Rights Assignment -> bestehende Collector-Keys.
  // Die Zuordnung erfolgt ausschliesslich ueber die verifizierten Windows-
  // Privilege-Namen. Der Snapshot-Collector verwendet fuer User Rights
  // `Security Settings > User Rights Assignment > Se...` als settingKey.
  // CIS-Varianten (DC/MS) bleiben als getrennte Empfehlungen erhalten; hier
  // wird nur die technische Einstellung identifiziert, nicht entschieden,
  // welche Variante fuer ein konkretes Zielsystem gilt.
  const USER_RIGHTS_SETTING_KEYS = {
    'Access Credential Manager as a trusted caller': 'SeTrustedCredManAccessPrivilege',
    'Access this computer from the network': 'SeNetworkLogonRight',
    'Act as part of the operating system': 'SeTcbPrivilege',
    'Add workstations to domain': 'SeMachineAccountPrivilege',
    'Adjust memory quotas for a process': 'SeIncreaseQuotaPrivilege',
    'Allow log on locally': 'SeInteractiveLogonRight',
    'Allow log on through Remote Desktop Services': 'SeRemoteInteractiveLogonRight',
    'Back up files and directories': 'SeBackupPrivilege',
    'Change the system time': 'SeSystemtimePrivilege',
    'Create a pagefile': 'SeCreatePagefilePrivilege',
    'Create a token object': 'SeCreateTokenPrivilege',
    'Create global objects': 'SeCreateGlobalPrivilege',
    'Create permanent shared objects': 'SeCreatePermanentPrivilege',
    'Create symbolic links': 'SeCreateSymbolicLinkPrivilege',
    'Debug programs': 'SeDebugPrivilege',
    'Deny access to this computer from the network': 'SeDenyNetworkLogonRight',
    'Deny log on as a batch job': 'SeDenyBatchLogonRight',
    'Deny log on as a service': 'SeDenyServiceLogonRight',
    'Deny log on locally': 'SeDenyInteractiveLogonRight',
    'Deny log on through Remote Desktop Services': 'SeDenyRemoteInteractiveLogonRight',
    'Enable computer and user accounts to be trusted for delegation': 'SeEnableDelegationPrivilege',
    'Force shutdown from a remote system': 'SeRemoteShutdownPrivilege',
    'Generate security audits': 'SeAuditPrivilege',
    'Impersonate a client after authentication': 'SeImpersonatePrivilege',
    'Increase scheduling priority': 'SeIncreaseBasePriorityPrivilege',
    'Load and unload device drivers': 'SeLoadDriverPrivilege',
    'Lock pages in memory': 'SeLockMemoryPrivilege',
    'Log on as a batch job': 'SeBatchLogonRight',
    'Manage auditing and security log': 'SeSecurityPrivilege',
    'Modify an object label': 'SeRelabelPrivilege',
    'Modify firmware environment values': 'SeSystemEnvironmentPrivilege',
    'Perform volume maintenance tasks': 'SeManageVolumePrivilege',
    'Profile single process': 'SeProfileSingleProcessPrivilege',
    'Profile system performance': 'SeSystemProfilePrivilege',
    'Replace a process level token': 'SeAssignPrimaryTokenPrivilege',
    'Restore files and directories': 'SeRestorePrivilege',
    'Shut down the system': 'SeShutdownPrivilege',
    'Synchronize directory service data': 'SeSyncAgentPrivilege',
    'Take ownership of files or other objects': 'SeTakeOwnershipPrivilege'
  };

  function applyUserRightsMappings(catalog) {
    let mappedRecommendations = 0;
    let mappedNames = new Set();
    (catalog.benchmarks || []).forEach(benchmark => {
      (benchmark.recommendations || []).forEach(recommendation => {
        const title = String(recommendation.title || '');
        const match = title.match(/^Ensure '([^']+)'/);
        const privilegeName = match ? USER_RIGHTS_SETTING_KEYS[match[1]] : null;
        if (!privilegeName || recommendation.parent !== '2.2') return;
        const settingKey = 'Security Settings > User Rights Assignment > ' + privilegeName;
        recommendation.settingKeys = [settingKey];
        recommendation.mapping = {
          type: 'exact-user-right',
          sourceName: match[1],
          settingKey
        };
        recommendation.status = 'mapped';
        mappedRecommendations++;
        mappedNames.add(match[1]);
      });
    });
    return { mappedRecommendations, mappedNames: Array.from(mappedNames).sort() };
  }

  function buildCisReferenceProvenance(catalog) {
    return {
      standard: 'CIS',
      role: 'Benchmark / Empfehlungen',
      source: String(catalog?.source || catalog?.generatedFrom || 'CIS Benchmark'),
      benchmarks: (catalog?.benchmarks || []).map(b => ({
        id: b.id || '',
        platform: b.platform || '',
        version: b.version || b.platform || ''
      }))
    };
  }

  async function load() {
    if (_catalog) return _catalog;
    const response = await fetch('./data/gpo/cis-server-baselines.json');
    if (!response.ok) throw new Error('CIS Server-Katalog konnte nicht geladen werden.');
    _catalog = await response.json();
    const baselineMappingSummary = applyBaselineSettingMappings(_catalog);
    const userRightsMappingSummary = applyUserRightsMappings(_catalog);
    const adminTemplateCandidateSummary = collectAdministrativeTemplateCandidates(_catalog);
    const adminTemplateCrossBaselineSummary = applyAdministrativeTemplateCrossBaselineMappings(_catalog);
    _catalog.adminTemplateCrossBaselineSummary = adminTemplateCrossBaselineSummary;
    _catalog.mappingCandidateSummary = adminTemplateCandidateSummary;

    _catalog.referenceProvenance = buildCisReferenceProvenance(_catalog);

    _catalog.mappingSummary = {
      mappedRecommendations:
        baselineMappingSummary.mappedRecommendations +
        userRightsMappingSummary.mappedRecommendations,
      baselineSettingNames: baselineMappingSummary.mappedNames,
      userRightsNames: userRightsMappingSummary.mappedNames,
      administrativeTemplateCrossBaseline: adminTemplateCrossBaselineSummary.byBenchmark,
      note: 'Mapping A + Mapping B werden zur Laufzeit aus dem unveränderten Katalog angewendet.'
    };
    return _catalog;
  }

  function detectVersion(computer) {
    const os = String(computer && computer.operatingSystem || '').toLowerCase();
    for (const version of Object.keys(VERSION_MARKERS)) {
      if (VERSION_MARKERS[version].some(marker => os.includes(marker))) return version;
    }
    return null;
  }

  function detectServers(computers) {
    const servers = (Array.isArray(computers) ? computers : [])
      .filter(c => c && (c.category === 'member_servers' || c.category === 'domain_controllers'));
    const byVersion = { '2019': [], '2022': [], '2025': [], unknown: [] };
    servers.forEach(c => {
      const version = detectVersion(c);
      (byVersion[version || 'unknown'] || byVersion.unknown).push(c);
    });
    return { total: servers.length, byVersion };
  }

  function getBenchmark(version) {
    if (!_catalog) return null;
    return (_catalog.benchmarks || []).find(b => b.id === 'windows-server-' + version) || null;
  }

  return { load, detectVersion, detectServers, getBenchmark, getUserRightsMappingNames: () => Object.keys(USER_RIGHTS_SETTING_KEYS) };
})();
