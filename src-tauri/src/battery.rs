use std::path::Path;
use std::process::Command;
use tauri::Manager;

const BATTERY_DIR: &str = "/usr/local/co.palokaj.battery";
const BATTERY_BIN: &str = "/usr/local/co.palokaj.battery/battery";
const SMC_BIN: &str = "/usr/local/co.palokaj.battery/smc";

const VISUDOCONFIG: &str = r#"# Visudo settings for the battery utility installed from https://github.com/actuallymentor/battery
# intended to be placed in /private/etc/sudoers.d/battery on a mac

# Allow passwordless update
ALL ALL = NOPASSWD: /usr/local/co.palokaj.battery/battery update_silent
ALL ALL = NOPASSWD: /usr/local/co.palokaj.battery/battery update_silent is_enabled

# Allow passwordless battery-charging–related SMC write commands
Cmnd_Alias    CHARGING_OFF = /usr/local/co.palokaj.battery/smc -k CH0B -w 02, /usr/local/co.palokaj.battery/smc -k CH0C -w 02, /usr/local/co.palokaj.battery/smc -k CHTE -w 01000000
Cmnd_Alias    CHARGING_ON = /usr/local/co.palokaj.battery/smc -k CH0B -w 00, /usr/local/co.palokaj.battery/smc -k CH0C -w 00, /usr/local/co.palokaj.battery/smc -k CHTE -w 00000000
Cmnd_Alias    FORCE_DISCHARGE_OFF = /usr/local/co.palokaj.battery/smc -k CH0I -w 00, /usr/local/co.palokaj.battery/smc -k CHIE -w 00, /usr/local/co.palokaj.battery/smc -k CH0J -w 00
Cmnd_Alias    FORCE_DISCHARGE_ON = /usr/local/co.palokaj.battery/smc -k CH0I -w 01, /usr/local/co.palokaj.battery/smc -k CHIE -w 08, /usr/local/co.palokaj.battery/smc -k CH0J -w 01
Cmnd_Alias    LED_CONTROL = /usr/local/co.palokaj.battery/smc -k ACLC -w 04, /usr/local/co.palokaj.battery/smc -k ACLC -w 03, /usr/local/co.palokaj.battery/smc -k ACLC -w 02, /usr/local/co.palokaj.battery/smc -k ACLC -w 01, /usr/local/co.palokaj.battery/smc -k ACLC -w 00
ALL ALL = NOPASSWD: CHARGING_OFF
ALL ALL = NOPASSWD: CHARGING_ON
ALL ALL = NOPASSWD: FORCE_DISCHARGE_OFF
ALL ALL = NOPASSWD: FORCE_DISCHARGE_ON
ALL ALL = NOPASSWD: LED_CONTROL

# Temporarily keep passwordless SMC reading commands
ALL ALL = NOPASSWD: /usr/local/co.palokaj.battery/smc -k CH0C -r, /usr/local/co.palokaj.battery/smc -k CH0I -r, /usr/local/co.palokaj.battery/smc -k ACLC -r, /usr/local/co.palokaj.battery/smc -k CHIE -r, /usr/local/co.palokaj.battery/smc -k CHTE -r
"#;

//Helpers 
fn find_resource(app_handle: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    let resource_dir = app_handle.path().resource_dir().map_err(|e| e.to_string())?;

    let direct = resource_dir.join(name);
    if direct.exists() {
        return Ok(direct);
    }

    let subfolder = resource_dir.join("resources").join(name);
    if subfolder.exists() {
        return Ok(subfolder);
    }

    Err(format!(
        "Resource '{}' not found. Checked:\n  1. {:?}\n  2. {:?}",
        name, direct, subfolder
    ))
}


fn run_battery(args: &[&str]) -> Result<String, String> {
    let output = Command::new(BATTERY_BIN)
        .current_dir("/tmp")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run battery command: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.is_empty() {
            format!("battery {} exited with status {}", args.join(" "), output.status)
        } else {
            stderr.into_owned()
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}



#[tauri::command]
pub fn is_installed() -> bool {
    let bat = Path::new(BATTERY_BIN);
    let smc = Path::new(SMC_BIN);

    if !bat.exists() || !smc.exists() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(meta_bat), Ok(meta_smc)) = (std::fs::metadata(bat), std::fs::metadata(smc)) {
            let mode_bat = meta_bat.mode();
            let mode_smc = meta_smc.mode();
            // Check if executable by owner, group, or others (mask 0o111)
            if (mode_bat & 0o111) == 0 || (mode_smc & 0o111) == 0 {
                return false;
            }
        } else {
            return false;
        }
    }

    true
}







#[tauri::command]
pub async fn install_tools(app_handle: tauri::AppHandle) -> Result<(), String> {
    let battery_src = find_resource(&app_handle, "battery.sh")?;
    let smc_src = find_resource(&app_handle, "smc")?;

    let temp_battery = Path::new("/tmp/battery_control_battery.sh");
    let temp_smc = Path::new("/tmp/battery_control_smc");

    std::fs::copy(&battery_src, temp_battery)
        .map_err(|e| format!("Failed to copy battery.sh to /tmp: {}", e))?;
    std::fs::copy(&smc_src, temp_smc)
        .map_err(|e| format!("Failed to copy smc to /tmp: {}", e))?;

    let visudo_escaped = VISUDOCONFIG.replace('"', "\\\"").replace('\n', "\\n");

    let script = format!(
        r#"do shell script "mkdir -p {dir} && cp '{bat}' {dir}/battery && cp '{smc}' {dir}/smc && chmod 755 {dir}/battery {dir}/smc && chown root:wheel {dir}/battery {dir}/smc && ln -sf {dir}/battery /usr/local/bin/battery && mkdir -p /private/etc/sudoers.d && echo '{visudo}' > /private/etc/sudoers.d/battery && chmod 440 /private/etc/sudoers.d/battery && chown root:wheel /private/etc/sudoers.d/battery" with administrator privileges"#,
        dir = BATTERY_DIR,
        bat = temp_battery.to_string_lossy(),
        smc = temp_smc.to_string_lossy(),
        visudo = visudo_escaped,
    );

    let output = Command::new("osascript")
        .current_dir("/tmp")
        .args(&["-e", &script])
        .output()
        .map_err(|e| e.to_string())?;

    // Clean up temp files
    let _ = std::fs::remove_file(temp_battery);
    let _ = std::fs::remove_file(temp_smc);

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }

    Ok(())
}


fn kill_dangling_commands() {
    let _ = Command::new("pkill")
        .args(&["-f", "battery discharge"])
        .output();
    let _ = Command::new("pkill")
        .args(&["-f", "battery charge"])
        .output();
}

fn is_process_running(pattern: &str) -> bool {
    let output = Command::new("pgrep")
        .args(&["-f", pattern])
        .output();
    if let Ok(out) = output {
        out.status.success()
    } else {
        false
    }
}


#[tauri::command]
pub async fn set_limit(limit: u8) -> Result<String, String> {
    kill_dangling_commands();
    std::thread::spawn(move || {
        let _ = run_battery(&["maintain", &limit.to_string()]);
    });
    Ok("Limit set".to_string())
}

pub fn reset_and_quit(app: tauri::AppHandle) {
    kill_dangling_commands();
    let _ = Command::new(BATTERY_BIN)
        .current_dir("/tmp")
        .args(&["maintain", "100"])
        .spawn();
    app.exit(0);
}






#[tauri::command]
pub async fn discharge(limit: u8) -> Result<String, String> {
    kill_dangling_commands();
    std::thread::spawn(move || {
        let _ = run_battery(&["discharge", &limit.to_string()]);
    });
    Ok("Discharge started".to_string())
}




#[tauri::command]
pub async fn top_up() -> Result<String, String> {
    kill_dangling_commands();
    std::thread::spawn(move || {
        let _ = run_battery(&["charge", "100"]);
    });
    Ok("Top up started".to_string())
}





#[derive(serde::Serialize)]
pub struct BatteryStatus {
    pub percentage: u32,
    pub remaining_time: String,
    pub charging_status: String,
    pub discharging_status: String,
    pub maintain_percentage: Option<u32>,
    pub is_discharging_active: bool,
    pub is_top_up_active: bool,
}


#[tauri::command]
pub async fn get_status() -> Result<BatteryStatus, String> {
    if !is_installed() {
        return Err("Battery CLI is not installed".to_string());
    }

    let csv = run_battery(&["status_csv"])?;
    let parts: Vec<&str> = csv.trim().split(',').collect();

    if parts.len() < 5 {
        return Err(format!("Unexpected status_csv output: {}", csv));
    }

    let is_discharging_active = is_process_running("battery discharge");
    let is_top_up_active = is_process_running("battery charge");

    Ok(BatteryStatus {
        percentage: parts[0].parse::<u32>().unwrap_or(0),
        remaining_time: parts[1].to_string(),
        charging_status: parts[2].to_string(),
        discharging_status: parts[3].to_string(),
        maintain_percentage: parts[4].parse::<u32>().ok(),
        is_discharging_active,
        is_top_up_active,
    })
}

