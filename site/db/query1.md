```mermaid
flowchart TD
    subgraph Tables
        R[ratings]
        RR[rating_responses]
        SP[service_providers]
    end

    subgraph CTE["Common Table Expression (RatingAverages)"]
        J1[Join ratings & responses]
        F1{is_submitted = 1?}
        J2[Optional: Join service_providers]
        F2{serviceBy filter?}
        AG1[Group by rating.id<br>Calculate AVG rating]
    end

    subgraph Final["Final Calculation"]
        COUNT[Count total ratings]
        AVG[Calculate overall average<br>ROUND to 1 decimal]
        OUT[Output:<br>total & avg_rating]
    end

    R --> J1
    RR --> J1
    J1 --> F1
    F1 -->|Yes| F2
    F1 -->|No| X[Exclude]
    
    F2 -->|Yes| J2
    F2 -->|No| AG1
    SP --> J2
    J2 --> AG1
    
    AG1 --> COUNT
    AG1 --> AVG
    COUNT --> OUT
    AVG --> OUT

    style CTE fill:#f9f,stroke:#333,stroke-width:2px
    style Final fill:#bbf,stroke:#333,stroke-width:2px
    style Tables fill:#dfd,stroke:#333,stroke-width:2px
    style OUT fill:#fdd,stroke:#333,stroke-width:2px