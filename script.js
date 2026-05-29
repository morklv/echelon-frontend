const API_URL = "https://echelon-c6sf.onrender.com";
// backend FastAPI server address

let token = "";
// stores JWT token after login

let currentUserRole = null;
// stores authenticated user role after login

const isAdmin = () => currentUserRole === "admin";
// returns true only if logged-in user is admin

const isOperator = () => currentUserRole === "operator";
// returns true only if logged-in user is operator

let map;
// stores Leaflet map globally

let markersLayer;
// stores incident markers

let infrastructureLayer;
// stores infrastructure asset markers

let riskOverlayLayer;
// stores temporary risk circles

let dependencyLayer;
// stores infrastructure dependency lines

let socket;
// stores WebSocket connection

let incidentMarkers = {};
// stores incident markers by incident ID
let refreshTimer = null;

function scheduleRefresh() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
        loadIncidents();
        loadInfrastructureAssets();
        loadInfrastructureDependencies();
        refreshTimer = null;
    }, 500);
}


function initializeMap() {
    // creates Leaflet tactical map

    if (map) {
        // prevents map from being initialized twice

        return;
        // stops function if map already exists
    }

    map = L.map("map", {
        zoomControl: false
    }).setView([37.7749, -122.4149], 12);
    // creates map centered on San Francisco

    L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
            subdomains: "abcd",
            maxZoom: 20,
            attribution: ""
        }
    ).addTo(map);
    // adds dark tactical map tiles

    riskOverlayLayer = L.layerGroup().addTo(map);
    // creates risk overlay layer

    dependencyLayer = L.layerGroup().addTo(map);
    // creates infrastructure dependency line layer

    infrastructureLayer = L.layerGroup().addTo(map);
    // creates infrastructure marker layer

    markersLayer = L.layerGroup().addTo(map);
    // creates incident marker layer
}


async function registerUser() {
    // registers new user

    const username = document.getElementById("username").value;
    // gets username input

    // const email = document.getElementById("email").value;
    // gets email input

    const password = document.getElementById("password").value;
    // gets password input

    const response = await fetch(`${API_URL}/auth/register`, {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            username: username,
            // email: email,
            password: password,
            role: "operator"
        })
    });
    // sends registration request; default role is operator

    const data = await response.json();
    // reads backend response

    document.getElementById("auth-status").innerText =
        response.ok
            ? `Registered: ${data.username}`
            : `Register failed: ${JSON.stringify(data.detail)}`;
    // updates auth status text
}


async function loginUser() {
    // logs user in and loads dashboard

    const username = document.getElementById("username").value;
    // gets username

    const password = document.getElementById("password").value;
    // gets password

    const formData = new URLSearchParams();
    // creates form data for OAuth2 login

    formData.append("username", username);
    // OAuth2 expects field named username

    formData.append("password", password);
    // OAuth2 expects field named password

    const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",

        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },

        body: formData.toString()
    });
    // sends login request to backend

    const data = await response.json();
    // reads login response

    if (!response.ok) {
        // checks failed login

        document.getElementById("auth-status").innerText =
            `Login failed: ${JSON.stringify(data.detail)}`;
        // shows login error

        return;
        // stops function
    }

    token = data.access_token;
    // stores JWT token globally

    currentUserRole = data.role;
    // stores user role from backend

    updateRoleIndicator();
    // updates role label in top bar

    applyRolePermissions();
    // applies frontend permission display rules

    document.getElementById("auth-status").innerText =
        "Logged in successfully";
    // shows login success

    document.getElementById("auth-panel").style.display = "none";
    // hides auth panel
    document.body.classList.add("authenticated");

    const dashboard = document.getElementById("main-dashboard");
    // gets dashboard container

    dashboard.classList.remove("hidden-dashboard");
    // removes hidden state

    dashboard.classList.add("visible-dashboard");
    // shows dashboard

    initializeMap();
    // initializes map
    connectWebSocket();

    loadInfrastructureAssets();
    // loads infrastructure markers

    loadInfrastructureDependencies();
    // loads dependency graph lines

    loadIncidents();
    // loads incidents/cards/markers

    console.log("Logged in role:", currentUserRole);
    // debug role check
    
}
function setButtonLoading(button, isLoading, loadingText, normalText) {
    if (!button) return;

    button.disabled = isLoading;
    button.innerHTML = isLoading
        ? `<span class="mini-spinner"></span> ${loadingText}`
        : normalText;
}

function updateRoleIndicator() {
    // updates top-bar role display

    const roleIndicator = document.getElementById("role-indicator");
    // gets role indicator element

    if (!roleIndicator) {
        return;
    }
    // safely exits if element does not exist

    roleIndicator.innerText = `ROLE: ${currentUserRole.toUpperCase()}`;
    // shows current role

    if (isAdmin()) {
        roleIndicator.style.color = "#ef4444";
        // admin appears red
    }

    else if (isOperator()) {
        roleIndicator.style.color = "#00e5ff";
        // operator appears cyan
    }
}


function applyRolePermissions() {
    // applies simple two-role frontend permissions

    const createIncidentButton = document.querySelector(".drawer-toggle");
    // gets create incident button

    if (!createIncidentButton) {
        return;
    }
    // safely exits if button does not exist

    createIncidentButton.style.display = "block";
    // both operator and admin can create incidents
}


async function createIncident() {
    // creates a new incident

    const title = document.getElementById("incident-title").value;
    // gets title

    const category = document.getElementById("incident-category").value;
    // gets category

    const severity = Number(document.getElementById("incident-severity").value);
    // gets severity as number

    const description = document.getElementById("incident-description").value;
    // gets description

    const latitude = Number(document.getElementById("latitude").value);
    // gets latitude

    const longitude = Number(document.getElementById("longitude").value);
    // gets longitude

    const response = await fetch(`${API_URL}/incidents/`, {
        method: "POST",

        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },

        body: JSON.stringify({
            title: title,
            category: category,
            severity: severity,
            description: description,
            latitude: latitude,
            longitude: longitude
        })
    });
    // sends create request

    const data = await response.json();
    // reads backend response

    if (response.ok) {


        scheduleRefresh();
        // reloads incidents

        addIntelligenceFeedItem(
            "info",
            `Incident created: ${title}`
        );
        // adds feed event
    }

    else {
        alert(`Failed to create incident: ${JSON.stringify(data.detail)}`);
        // shows error
    }
}


function getSeverityColor(severity) {
    // returns marker color based on severity

    if (severity >= 5) {
        return "#ff3b30";
    }
    // critical red

    if (severity >= 4) {
        return "#ff9500";
    }
    // high orange

    if (severity >= 3) {
        return "#ffd60a";
    }
    // medium yellow

    return "#00e5ff";
    // low cyan
}


async function getNearbyInfrastructureHtml(incidentId) {
    // loads affected infrastructure for an incident

    const response = await fetch(
        `${API_URL}/incidents/${incidentId}/nearby-infrastructure`,
        {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        }
    );
    // asks backend for nearby infrastructure

    if (!response.ok) {
        return `
            <div class="infrastructure-risk-block">
                <h4>Affected Infrastructure</h4>
                <p>Infrastructure risk unavailable</p>
            </div>
        `;
    }
    // fallback if request fails

    const data = await response.json();
    // reads backend infrastructure response

    const assets = data.nearby_assets || [];
    // gets affected assets

    const recommendation =
        data.infrastructure_recommendation || "No recommendation available.";
    // gets recommendation text

    const operationalRiskScore = data.operational_risk_score ?? "N/A";
    // gets infrastructure risk score

    const criticalAssetCount = data.critical_asset_count ?? 0;
    // gets critical asset count

    const cascadeAssetCount = data.cascade_asset_count ?? 0;
    // gets cascade impact count

    if (assets.length === 0) {
        return `
            <div class="infrastructure-risk-block">
                <h4>Affected Infrastructure</h4>
                <p>No nearby critical assets detected</p>

                <div class="infrastructure-recommendation">
                    <h4>Infrastructure Recommendation</h4>
                    <pre>${recommendation}</pre>
                </div>
            </div>
        `;
    }
    // returns no-assets UI

    const assetRows = assets.map(asset => `
        <div class="asset-risk-row">
            <strong>${asset.name}</strong>

            <p>Type: ${asset.asset_type}</p>
            <p>Criticality: ${asset.criticality}</p>
            <p>Operational Status: ${asset.operational_status}</p>
            <p>Risk Status: ${asset.risk_status || "UNKNOWN"}</p>

            ${
                asset.risk_status === "CASCADE_RISK"
                    ? `
                        <p>Impact Type: Cascade dependency</p>
                        <p>Cascade Source: ${asset.source_asset_name || "Unknown source"}</p>
                        <p>Dependency Type: ${asset.dependency_type || "dependency"}</p>
                    `
                    : `
                        <p>Distance: ${asset.distance_km} km</p>
                    `
            }

            ${
                asset.cascade_reason
                    ? `<p>Cascade Reason: ${asset.cascade_reason}</p>`
                    : ""
            }
        </div>
    `).join("");

    return `
        <div class="infrastructure-risk-block">
            <h4>Affected Infrastructure</h4>

            <div class="infrastructure-summary">
                <p><strong>Infrastructure Risk Score:</strong> ${operationalRiskScore}</p>
                <p><strong>Critical Assets:</strong> ${criticalAssetCount}</p>
                <p><strong>Cascade Impacts:</strong> ${cascadeAssetCount}</p>
            </div>

            ${assetRows}

            <div class="infrastructure-recommendation">
                <h4>Infrastructure Recommendation</h4>
                <pre>${recommendation}</pre>
            </div>
        </div>
    `;
    // returns full infrastructure block
}
async function showIncidentInfrastructure(incidentId) {
    const block = document.getElementById(`infra-block-${incidentId}`);

    if (!block) {
        return;
    }

    block.innerHTML = `
        <div class="loading-state">
            <span class="mini-spinner"></span>
            Loading affected infrastructure...
        </div>
    `;

    const html = await getNearbyInfrastructureHtml(incidentId);

    block.innerHTML = html;

    loadInfrastructureAssets();
    loadInfrastructureDependencies();
}


function drawInfrastructureRiskZone(incident, nearbyAssets) {
    // draws operational impact radius

    riskOverlayLayer.clearLayers();
    // removes previous overlays

    const riskCircle = L.circle(
        [incident.latitude, incident.longitude],
        {
            radius: 1000,

            color: "rgba(220, 220, 220, 0.85)",

            fillColor: "rgba(120, 120, 120, 0.35)",

            fillOpacity: 0.12,

            opacity: 0.95,

            weight: 2,

            dashArray: "8 8"
        }
    );
    // creates tactical operational radius

    riskCircle.addTo(riskOverlayLayer);
    // adds radius to map

    riskCircle.bringToFront();
    // keeps radius visible above map

    nearbyAssets.forEach(asset => {
        // draws lines to directly affected assets

        if (!asset.latitude || !asset.longitude) {
            return;
        }

        const line = L.polyline(
            [
                [incident.latitude, incident.longitude],
                [asset.latitude, asset.longitude]
            ],
            {
                color: "rgba(220,220,220,0.45)",

                weight: 1.2,

                opacity: 0.7,

                dashArray: "4 8"
            }
        );

        line.addTo(riskOverlayLayer);
    });
}


async function loadIncidents() {
    // loads incidents from backend

    const response = await fetch(`${API_URL}/incidents/`, {
        method: "GET",

        headers: {
            "Authorization": `Bearer ${token}`
        }
    });
    // sends authenticated request

    const data = await response.json();
    // reads backend response

    if (!response.ok) {
        console.log("Failed to load incidents:", data);

        document.getElementById("incident-list").innerHTML =
            `<p>Failed to load incidents. Please log in first.</p>`;

        return;
    }
    // stops if request failed

    const incidents = Array.isArray(data) ? data : [];
    // ensures incidents is an array

    document.getElementById("total-incidents").innerText =
        incidents.length;
    // updates total count

    document.getElementById("high-severity-count").innerText =
        incidents.filter(incident => incident.severity >= 4).length;
    // updates high severity count

    document.getElementById("open-incidents-count").innerText =
        incidents.filter(incident => incident.status === "open").length;
    // updates open count

    document.getElementById("closed-incidents-count").innerText =
        incidents.filter(
            incident =>
                incident.status === "closed" ||
                incident.status === "resolved"
        ).length;
    // updates closed/resolved count

    const severityFilter = document.getElementById("severity-filter").value;
    // gets severity filter

    const statusFilter = document.getElementById("status-filter").value;
    // gets status filter

    const categoryFilter =
        document.getElementById("category-filter").value.toLowerCase();
    // gets category filter

    const incidentList = document.getElementById("incident-list");
    // gets incident list container
    incidentList.innerHTML = `
        <div class="loading-state">
            <span class="mini-spinner"></span>
            Loading incidents...
        </div>
    `;


    incidentList.innerHTML = "";
    // clears incident list

    markersLayer.clearLayers();
    // clears incident markers

    incidentMarkers = {};
    // resets marker storage

    for (const [index, incident] of incidents.entries()) {
        // loops through incidents

        if (severityFilter && incident.severity != severityFilter) {
            continue;
        }
        // skips nonmatching severity

        if (statusFilter && incident.status !== statusFilter) {
            continue;
        }
        // skips nonmatching status

        if (
            categoryFilter &&
            !incident.category.toLowerCase().includes(categoryFilter)
        ) {
            continue;
        }
        // skips nonmatching category

        const canEditIncidents = true;
        // both operator and admin can edit incidents

        const canDeleteIncidents = isAdmin();
        // only admins can delete incidents

        const card = document.createElement("div");
        // creates incident card element

        card.className = "incident-card";
        // assigns card class

        card.id = `incident-card-${incident.id}`;
        // gives card unique ID

        card.innerHTML = `
            <h3>${incident.title}</h3>

            <p><strong>ID:</strong> ${index + 1}</p>
            <p><strong>Database ID:</strong> ${incident.id}</p>
            <p><strong>Category:</strong> ${incident.category}</p>

            <p>
                <span class="badge" style="background-color: ${getSeverityColor(incident.severity)};">
                    SEVERITY ${incident.severity}
                </span>

                <span class="badge status-badge">
                    ${incident.status.toUpperCase()}
                </span>
            </p>

            <p><strong>Description:</strong> ${incident.description || "No description"}</p>

            <p><strong>Location:</strong> ${incident.latitude}, ${incident.longitude}</p>
            ${
                incident.image_path
                    ? `
                        <div class="incident-image-preview">
                            <img
                                src="${API_URL}${incident.image_path}"
                                alt="Incident evidence image"
                            />
                        </div>
                    `
                    : `
                        <div class="incident-image-placeholder">
                            No evidence image uploaded
                        </div>
                    `
            }
            <p><strong>Image Analysis:</strong> ${formatImageAnalysis(incident.image_analysis)}</p>

            <div class="llm-brief">
                <h4>Operator Brief</h4>
                <pre>${incident.llm_summary || "No summary yet"}</pre>
            </div>

           <div
                id="infra-block-${incident.id}"
                class="infrastructure-risk-block"
            >
                <h4>Affected Infrastructure</h4>
                <p>Click below to load direct and cascaded asset impact.</p>
            </div>

            <button onclick="showIncidentInfrastructure(${incident.id})">
                Show affected infrastructure
            </button>

            <div class="evidence-upload">
                <label
                    class="evidence-upload-label"
                    for="image-input-${incident.id}"
                >
                    <span class="upload-title">
                        Upload Evidence Image
                    </span>

                    <span class="upload-subtitle">
                        JPG / PNG / WEBP · Max 5MB
                    </span>
                </label>

                <input
                    id="image-input-${incident.id}"
                    class="hidden-file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                />
            </div>

            <button
                id="upload-btn-${incident.id}"
                onclick="uploadImageForIncident(${incident.id})">
                Upload image for this incident
            </button>

            ${canEditIncidents ? `
                <button onclick='openIncidentEditDrawer(${JSON.stringify(incident)})'>
                    Update Incident
                </button>
            ` : ""}

            ${canDeleteIncidents ? `
                <button onclick="deleteIncident(${incident.id})">
                    Delete Incident
                </button>
            ` : ""}

            <button onclick="focusIncidentOnMap(${incident.id})">
                Focus on Map
            </button>
        `;
        // fills card HTML

        incidentList.appendChild(card);
        // adds card to list

        const incidentColor =
            incident.status === "resolved"
                ? "#64748b"
                : getSeverityColor(incident.severity);
        // resolved incidents become gray

        const incidentIcon = L.divIcon({
            className: "incident-pulse-icon",

            html: `
                <div
                    class="
                        incident-pulse
                        ${incident.severity >= 5 ? "incident-critical" : ""}
                        ${incident.status === "resolved" ? "incident-resolved" : ""}
                    "
                    style="--incident-color:${incidentColor};"
                >
                    <div class="incident-pulse-ring"></div>
                    <div class="incident-pulse-ring second"></div>
                    <div class="incident-pulse-core"></div>
                </div>
            `,

            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });
        // creates custom incident icon

        const marker = L.marker(
            [incident.latitude, incident.longitude],
            {
                icon: incidentIcon
            }
        ).addTo(markersLayer);
        // creates incident marker

        incidentMarkers[incident.id] = marker;
        // stores marker by incident ID

        marker.bindPopup(
            `
                <strong>${incident.title}</strong><br>
                Category: ${incident.category}<br>
                Severity: ${incident.severity}<br>
                Status: ${incident.status}
            `,
            {
                autoPan: false
            }
        );
        // attaches popup

        marker.on("click", () => {
            highlightIncidentCard(incident.id);
        });
        // highlights card when marker clicked
    }
}


async function uploadImageForIncident(incidentId) {
    // uploads image evidence for incident

    const uploadButton = document.getElementById(`upload-btn-${incidentId}`);
    // gets upload button for this incident

    setButtonLoading(
        uploadButton,
        true,
        "Analyzing image...",
        "Upload image for this incident"
    );

    try {
        const fileInput = document.getElementById(`image-input-${incidentId}`);
        // gets file input

        const file = fileInput.files[0];
        // gets selected file

        if (!file) {
            alert("Please choose an image first.");
            return;
        }

        const formData = new FormData();
        // creates multipart form data

        formData.append("file", file);
        // attaches file

        const response = await fetch(
            `${API_URL}/incidents/${incidentId}/upload-image`,
            {
                method: "POST",

                headers: {
                    "Authorization": `Bearer ${token}`
                },

                body: formData
            }
        );

        const data = await response.json();

        if (response.ok) {
            addIntelligenceFeedItem(
                "info",
                `Analyzing image for incident ${incidentId}`
            );

            scheduleRefresh();
        }

        else {
            alert(`Image upload failed: ${JSON.stringify(data.detail)}`);
        }
    }

    finally {
        setButtonLoading(
            uploadButton,
            false,
            "Analyzing image...",
            "Upload image for this incident"
        );
    }
}


function openIncidentEditDrawer(incident) {
    // opens incident edit drawer

    document.getElementById("edit-incident-id").value = incident.id;

    document.getElementById("edit-incident-title").value =
        incident.title;

    document.getElementById("edit-incident-description").value =
        incident.description || "";

    document.getElementById("edit-incident-category").value =
        incident.category;

    document.getElementById("edit-incident-status").value =
        incident.status;

    document.getElementById("edit-incident-severity").value =
        incident.severity;

    document.getElementById("edit-incident-latitude").value =
        incident.latitude;

    document.getElementById("edit-incident-longitude").value =
        incident.longitude;

    document
        .getElementById("incident-edit-drawer")
        .classList.add("incident-edit-drawer-open");

    const feedPanel = document.getElementById(
        "intelligence-feed-panel"
    );

    feedPanel.classList.remove("feed-shift-create");
    feedPanel.classList.add("feed-shift-edit");
}


function closeIncidentEditDrawer() {
    // closes incident edit drawer

    document
        .getElementById("incident-edit-drawer")
        .classList.remove("incident-edit-drawer-open");

    const feedPanel = document.getElementById(
        "intelligence-feed-panel"
    );

    feedPanel.classList.remove("feed-shift-edit");
}


async function submitIncidentUpdate() {
    // submits incident update

    const incidentId = document.getElementById("edit-incident-id").value;

    const title =
        document.getElementById("edit-incident-title").value;

    const description =
        document.getElementById("edit-incident-description").value;

    const category =
        document.getElementById("edit-incident-category").value;

    const status =
        document.getElementById("edit-incident-status").value;

    const severity = Number(
        document.getElementById("edit-incident-severity").value
    );

    const latitude = Number(
        document.getElementById("edit-incident-latitude").value
    );

    const longitude = Number(
        document.getElementById("edit-incident-longitude").value
    );

    const response = await fetch(
        `${API_URL}/incidents/${incidentId}`,
        {
            method: "PATCH",

            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },

            body: JSON.stringify({
                title: title,
                description: description.trim() === "" ? null : description,
                category: category,
                status: status,
                severity: severity,
                latitude: latitude,
                longitude: longitude
            })
        }
    );

    const data = await response.json();

    if (response.ok) {
        addIntelligenceFeedItem(
            "info",
            "Incident updated successfully");

        closeIncidentEditDrawer();

        scheduleRefresh();
    }

    else {
        alert(`Update failed: ${JSON.stringify(data.detail)}`);
    }
}


async function updateInfrastructureAsset(asset) {
    // updates infrastructure asset; admin-only from UI

    if (!isAdmin()) {
        addIntelligenceFeedItem(
            "warning",
            "Only admins can edit infrastructure assets"
        );
        return;
    }
    // blocks non-admin users

    const name = prompt("New asset name:", asset.name) || asset.name;
    // asks for name

    const assetType =
        prompt("New asset type:", asset.asset_type) || asset.asset_type;
    // asks for type

    const latitude =
        prompt("New latitude:", asset.latitude) || asset.latitude;
    // asks for latitude

    const longitude =
        prompt("New longitude:", asset.longitude) || asset.longitude;
    // asks for longitude

    const criticality =
        prompt("New criticality:", asset.criticality) || asset.criticality;
    // asks for criticality

    const description =
        prompt("New description:", asset.description) || asset.description;
    // asks for description

    const operationalStatus =
        prompt("Operational status:", asset.operational_status) ||
        asset.operational_status;
    // asks for status

    const response = await fetch(
        `${API_URL}/infrastructure/${asset.id}`,
        {
            method: "PATCH",

            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },

            body: JSON.stringify({
                name: name,
                asset_type: assetType,
                latitude: Number(latitude),
                longitude: Number(longitude),
                criticality: criticality,
                description: description,
                operational_status: operationalStatus,
                geometry_type: asset.geometry_type,
                geometry_coordinates: asset.geometry_coordinates
            })
        }
    );
    // sends update request

    const data = await response.json();
    // reads backend response

    if (response.ok) {
        addIntelligenceFeedItem(
            "info",
            "Infrastructure asset updated successfully");
        loadInfrastructureAssets();
        loadInfrastructureDependencies();
    }

    else {
        alert(`Infrastructure update failed: ${JSON.stringify(data.detail)}`);
    }
}


function formatImageAnalysis(imageAnalysis) {
    // formats CV analysis for card display

    if (!imageAnalysis) {
        return `<p><strong>Image Analysis:</strong> No analysis yet</p>`;
    }
    // handles no analysis

    let analysis;
    // creates variable for parsed analysis

    try {
        analysis = JSON.parse(imageAnalysis);
    }

    catch {
        return `<p><strong>Image Analysis:</strong> Invalid analysis data</p>`;
    }
    // safely parses JSON

    const blurryText = analysis.is_blurry ? "Yes" : "No";
    // converts blur boolean to text

    const detectedObjects = analysis.detected_objects || [];
    // gets YOLO objects

    const objectsText = detectedObjects.length > 0
        ? detectedObjects
            .map(obj => `${obj.label} (${Math.round(obj.confidence * 100)}%)`)
            .join(", ")
        : "No known objects detected";
    // formats object list

    const hazard = analysis.hazard_analysis || {};
    // gets hazard analysis

    const fireSmoke = analysis.fire_smoke_analysis || {};
    // gets fire/smoke analysis

    const structural = analysis.structural_analysis || {};
    // gets structural analysis

    const fusion = analysis.intelligence_fusion || {};
    // gets fusion analysis

    const scene = analysis.scene_analysis || {};
    // gets scene analysis

    const traffic = analysis.traffic_activity || {};
    // gets traffic analysis

    return `
        <div class="analysis-block">
            <h4>Image Quality</h4>
            <p><strong>Blur Score:</strong> ${analysis.blur_score ?? "N/A"}</p>
            <p><strong>Blurry:</strong> ${blurryText}</p>

            <hr>

            <h4>Detected Objects</h4>
            <p>${objectsText}</p>

            <hr>

            <h4>Structural Analysis</h4>
            <p><strong>Damage Tier:</strong> ${structural.damage_tier || "UNKNOWN"}</p>
            <p><strong>Damage Score:</strong> ${structural.damage_score ?? "N/A"}</p>
            <p><strong>Edge Density:</strong> ${structural.edge_density ?? "N/A"}</p>
            <p><strong>Line Count:</strong> ${structural.line_count ?? "N/A"}</p>
            <p><strong>Line Angle Variance:</strong> ${structural.line_angle_variance ?? "N/A"}</p>

            <hr>

            <h4>Scene Analysis</h4>
            <p><strong>Person Count:</strong> ${scene.person_count ?? "N/A"}</p>
            <p><strong>Vehicle Count:</strong> ${scene.vehicle_count ?? "N/A"}</p>
            <p><strong>Total Entities:</strong> ${scene.total_entities ?? "N/A"}</p>
            <p><strong>Density Tier:</strong> ${scene.density_tier || "UNKNOWN"}</p>
            <p><strong>Abnormal Cluster:</strong> ${scene.abnormal_cluster_detected ? "Yes" : "No"}</p>

            <hr>

            <h4>Hazard Analysis</h4>
            <p><strong>Hazard Tier:</strong> ${hazard.hazard_tier || "UNKNOWN"}</p>
            <p><strong>Hazard Confidence:</strong> ${hazard.hazard_confidence ?? "N/A"}</p>
            <p><strong>Fire Pixel Ratio:</strong> ${hazard.fire_pixel_ratio ?? "N/A"}</p>
            <p><strong>Smoke Pixel Ratio:</strong> ${hazard.smoke_pixel_ratio ?? "N/A"}</p>
            <p><strong>Texture Variance:</strong> ${hazard.texture_variance ?? "N/A"}</p>

            <hr>

            <h4>Fire / Smoke Analysis</h4>
            <p><strong>Hazard Tier:</strong> ${fireSmoke.hazard_tier || "UNKNOWN"}</p>
            <p><strong>Fire Score:</strong> ${fireSmoke.fire_score ?? "N/A"}</p>
            <p><strong>Smoke Score:</strong> ${fireSmoke.smoke_score ?? "N/A"}</p>
            <p><strong>Fire Pixel Ratio:</strong> ${fireSmoke.fire_pixel_ratio ?? "N/A"}</p>
            <p><strong>Smoke Pixel Ratio:</strong> ${fireSmoke.smoke_pixel_ratio ?? "N/A"}</p>
            <p><strong>Texture Variance:</strong> ${fireSmoke.texture_variance ?? "N/A"}</p>

            <hr>

            <h4>Traffic Activity</h4>
            <p><strong>Vehicle Count:</strong> ${traffic.vehicle_count ?? "N/A"}</p>
            <p><strong>Person Count:</strong> ${traffic.person_count ?? "N/A"}</p>
            <p><strong>Total Road Entities:</strong> ${traffic.total_road_entities ?? "N/A"}</p>
            <p><strong>Traffic Density:</strong> ${traffic.traffic_density || "UNKNOWN"}</p>
            <p><strong>Road Activity:</strong> ${traffic.road_activity_detected ? "Yes" : "No"}</p>

            <hr>

            <h4>Composite Intelligence</h4>
            <p><strong>Overall Risk Score:</strong> ${fusion.overall_risk_score ?? "N/A"}</p>
            <p><strong>Risk Tier:</strong> ${fusion.risk_tier || "UNKNOWN"}</p>
            <p><strong>Primary Hazard:</strong> ${fusion.primary_hazard || "UNKNOWN"}</p>
            <p><strong>Structural Damage:</strong> ${fusion.structural_damage || "UNKNOWN"}</p>
            <p><strong>Recommended Action:</strong> ${fusion.recommended_action || "N/A"}</p>
        </div>
    `;
    // returns formatted analysis block
}


function connectWebSocket() {
    // connects frontend to backend websocket

    socket = new WebSocket("ws://127.0.0.1:8000/ws");
    // creates websocket connection

    socket.onopen = () => {
        console.log("WebSocket connected");
    };
    // logs successful websocket connection

    socket.onmessage = (event) => {
        // handles incoming websocket messages

        const data = JSON.parse(event.data);
        // parses websocket JSON

        const eventType = data.event || data.event_type;
        // supports both event and event_type formats

        console.log("WebSocket event received:", data);
        // logs websocket message

        if (eventType === "incident_created") {
            addIntelligenceFeedItem(
                "info",
                `New incident created: ID ${data.incident_id}`
            );

            scheduleRefresh();
        }

        if (eventType === "incident_updated") {
            addIntelligenceFeedItem(
                "info",
                `Incident updated: ID ${data.incident_id}`
            );

            scheduleRefresh();
        }

        if (eventType === "incident_deleted") {
            addIntelligenceFeedItem(
                "warning",
                `Incident deleted: ID ${data.incident_id}`
            );

            scheduleRefresh();
        }

        if (eventType === "analysis_completed") {
            addIntelligenceFeedItem(
                "critical",
                `Image intelligence analysis completed for incident ${data.incident_id}`
            );

            scheduleRefresh();
        }

        if (eventType === "infrastructure_updated") {
            addIntelligenceFeedItem(
                "warning",
                "Infrastructure dependency state updated"
            );

            scheduleRefresh();
        }
    };

    socket.onclose = () => {
        console.log("WebSocket disconnected. Reconnecting in 3 seconds...");

        setTimeout(() => {
            connectWebSocket();
        }, 3000);
    };
    // reconnects after disconnect
}


async function deleteIncident(incidentId) {
    // deletes incident; admin-only from UI

    if (!isAdmin()) {
        addIntelligenceFeedItem(
            "warning",
            "Only admins can delete incidents"
        );

        return;
    }
    // blocks non-admin delete attempts

    const confirmed = confirm(`Delete incident ${incidentId}?`);
    // asks for confirmation

    if (!confirmed) {
        return;
    }
    // stops if user cancels

    const response = await fetch(`${API_URL}/incidents/${incidentId}`, {
        method: "DELETE",

        headers: {
            "Authorization": `Bearer ${token}`
        }
    });
    // sends DELETE request

    const data = await response.json();
    // reads backend response

    if (response.ok) {
        addIntelligenceFeedItem(
            "warning",
            "Incident deleted successfully");
        scheduleRefresh();;
    }

    else {
        alert(`Delete failed: ${JSON.stringify(data.detail)}`);
    }
}


function clearFilters() {
    // resets incident filters

    document.getElementById("severity-filter").value = "";
    // clears severity

    document.getElementById("status-filter").value = "";
    // clears status

    document.getElementById("category-filter").value = "";
    // clears category

    loadIncidents();
    // reloads incidents
}


async function focusIncidentOnMap(incidentId) {
    // focuses map on incident marker

    const marker = incidentMarkers[incidentId];
    // gets marker by incident ID

    if (!marker) {
        alert("No marker found for this incident.");
        return;
    }
    // stops if marker not found

    const markerPosition = marker.getLatLng();
    // gets marker position

    map.setView(markerPosition, 15);
    // zooms map to incident

    marker.openPopup();
    // opens popup

    const response = await fetch(
        `${API_URL}/incidents/${incidentId}/nearby-infrastructure`,
        {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        }
    );
    // gets nearby infrastructure

    const data = await response.json();
    // reads response

    const nearbyAssets = data.nearby_assets || [];
    // gets nearby assets

    drawInfrastructureRiskZone(
        {
            latitude: markerPosition.lat,
            longitude: markerPosition.lng
        },
        nearbyAssets
    );
    // draws risk circle

    loadInfrastructureAssets();
    // reloads infrastructure states

    loadInfrastructureDependencies();
    // reloads dependency lines
}


function highlightIncidentCard(incidentId) {
    const drawer = document.getElementById("incidents-drawer");

    const card = document.getElementById(
        `incident-card-${incidentId}`
    );

    if (!drawer || !card) {
        return;
    }

    if (!drawer.classList.contains("incidents-drawer-open")) {
        drawer.classList.add("incidents-drawer-open");
    }

    card.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });

    card.classList.add("highlighted-card");

    setTimeout(() => {
        card.classList.remove("highlighted-card");
    }, 2000);
}

function toggleIncidentDrawer() {
    if (!currentUserRole) {
        addIntelligenceFeedItem(
            "warning",
            "Authentication required"
        );
        return;
    }

    const drawer = document.getElementById("incident-drawer");

    const createButton =
        document.querySelector(".drawer-toggle:not(.incidents-toggle)");

    const incidentsButton =
        document.querySelector(".incidents-toggle");

    const feedPanel =
        document.getElementById("intelligence-feed-panel");

    const isOpen = drawer.classList.contains("drawer-open");

    if (!isOpen) {
        createButton.classList.add("hide-drawer-button");
        incidentsButton.classList.add("hide-drawer-button");

        feedPanel.classList.add("feed-shift-create");
        feedPanel.classList.remove("feed-shift-edit");

        drawer.classList.add("drawer-open");
    }

    else {
        drawer.classList.remove("drawer-open");

        feedPanel.classList.remove("feed-shift-create");

        setTimeout(() => {
            createButton.classList.remove("hide-drawer-button");
            incidentsButton.classList.remove("hide-drawer-button");
        }, 350);
    }
}


function toggleIncidentsDrawer() {
    // opens/closes incident list drawer

    const drawer = document.getElementById("incidents-drawer");
    // gets drawer

    const button = document.querySelector(".incidents-toggle");
    // gets incidents button

    const isOpen = drawer.classList.contains("incidents-drawer-open");
    // checks drawer state

    if (!isOpen) {
        button.classList.add("hide-drawer-button");

        setTimeout(() => {
            drawer.classList.add("incidents-drawer-open");
            loadIncidents();
        }, 300);
    }

    else {
        drawer.classList.remove("incidents-drawer-open");

        setTimeout(() => {
            button.classList.remove("hide-drawer-button");
        }, 400);

        riskOverlayLayer.clearLayers();
    }
}


function getAssetStatusClass(status) {
    // converts infrastructure status into CSS class

    if (status === "AT_RISK") {
        return "asset-at-risk";
    }

    if (status === "DEGRADED") {
        return "asset-degraded";
    }

    if (status === "OFFLINE") {
        return "asset-offline";
    }

    return "asset-normal";
}


async function loadInfrastructureAssets() {
    // loads infrastructure assets

    const response = await fetch(`${API_URL}/infrastructure/`);
    // requests infrastructure assets

    const assets = await response.json();
    // reads response

    infrastructureLayer.clearLayers();
    // clears old markers

    assets.forEach(asset => {
        // loops through assets

        const isCascadeRisk = asset.risk_status === "CASCADE_RISK";
        // checks cascade risk

        const assetOpacity = isAdmin() ? 1 : 0.72;
        // admin sees full marker strength

        const assetScale = isAdmin() ? 1.0 : 0.82;
        // non-admin markers appear smaller

        const assetIcon = L.divIcon({
            className: "infrastructure-icon",

            html: `
                <div
                    class="
                        asset-triangle
                        ${getAssetStatusClass(asset.operational_status)}
                        ${isCascadeRisk ? "cascade-risk" : ""}
                    "
                    style="
                        opacity: ${assetOpacity};
                        transform: scale(${assetScale});
                    "
                ></div>
            `,

            iconSize: [14, 14],
            iconAnchor: [7, 10]
        });
        // creates infrastructure icon

        const marker = L.marker(
            [asset.latitude, asset.longitude],
            {
                icon: assetIcon
            }
        ).addTo(infrastructureLayer);
        // adds marker

        marker.bindPopup(
            `
                <strong>${asset.name}</strong><br>
                Type: ${asset.asset_type}<br><br>

                ${
                    isAdmin()
                        ? `
                            Criticality: ${asset.criticality}<br>
                            Status: ${asset.operational_status}<br>
                            Risk: ${asset.risk_status}<br>
                            ${asset.description || ""}<br><br>

                            <button onclick='updateInfrastructureAsset(${JSON.stringify(asset)})'>
                                Edit Asset
                            </button>
                        `
                        : `
                            Restricted infrastructure details
                        `
                }
            `,
            {
                autoPan: false
            }
        );
        // attaches role-aware popup
    });
}


async function loadInfrastructureDependencies() {
    // loads dependency graph

    const response = await fetch(`${API_URL}/infrastructure-dependencies/`);
    // requests dependencies

    const data = await response.json();
    // reads response

    const dependencies = data.dependencies || [];
    // gets dependency list

    dependencyLayer.clearLayers();
    // clears old lines

    dependencies.forEach(edge => {
        // loops through dependency edges

        const source = edge.source;
        // gets source asset

        const dependent = edge.dependent;
        // gets dependent asset

        let lineColor = "#00e5ff";
        // default dependency color

        if (
            source.risk_status === "CASCADE_RISK" ||
            dependent.risk_status === "CASCADE_RISK"
        ) {
            lineColor = "#c084fc";
        }
        // purple for cascade risk

        if (
            source.operational_status === "DEGRADED" ||
            dependent.operational_status === "DEGRADED"
        ) {
            lineColor = "#ff9500";
        }
        // orange for degraded infrastructure

        if (
            source.operational_status === "OFFLINE" ||
            dependent.operational_status === "OFFLINE"
        ) {
            lineColor = "#ff3b30";
        }
        // red for offline infrastructure

        const line = L.polyline(
            [
                [source.latitude, source.longitude],
                [dependent.latitude, dependent.longitude]
            ],
            {
                color: lineColor,
                weight: 1.4,
                opacity: 0.42,
                dashArray: "4 10",
                lineCap: "round",
                smoothFactor: 1.5,
                className: "dependency-flow-line"
            }
        );
        // creates animated dependency line

        line.bindPopup(
            `
                <strong>Infrastructure Dependency</strong><br><br>

                <strong>Source:</strong> ${source.name}<br>
                ${source.asset_type}<br>
                Status: ${source.operational_status}<br><br>

                <strong>Dependent:</strong> ${dependent.name}<br>
                ${dependent.asset_type}<br>
                Status: ${dependent.operational_status}<br><br>

                <strong>Dependency:</strong> ${edge.dependency_type}<br>

                ${edge.description || ""}
            `,
            {
                autoPan: false
            }
        );

        line.addTo(dependencyLayer);
        // adds line to map
    });
}


function addIntelligenceFeedItem(level, message) {
    // adds item to intelligence feed

    const feedList = document.getElementById("intelligence-feed-list");
    // gets feed list container

    if (!feedList) {
        return;
        // stops if feed does not exist
    }
    if (!message) {
        return;
    }

    const now = new Date().toLocaleTimeString();
    // creates current timestamp

    const item = document.createElement("div");
    // creates notification element

    item.className = `intel-feed-item intel-${level}`;
    // applies notification severity styling

    item.innerHTML = `
        <button
            class="intel-dismiss"
            onclick="dismissIntelFeedItem(this)"
        >
            ×
        </button>

        <span class="intel-time">${now}</span>

        <p>${message}</p>
    `;
    // adds close button, time, and message

    feedList.prepend(item);
    // places newest notification at top
}

function dismissIntelFeedItem(button) {
    // removes one notification with animation

    const item = button.closest(".intel-feed-item");
    // finds parent notification item

    if (!item) {
        return;
        // stops if item was not found
    }

    item.classList.add("intel-feed-removing");
    // starts slide/fade-out animation

    setTimeout(() => {
        item.remove();
        // removes notification after animation finishes
    }, 260);
}


//connectWebSocket();
// starts websocket connection


// starts websocket connection

//Latitude: 37.6545
//Longitude: -122.1188
