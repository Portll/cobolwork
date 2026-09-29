       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYSAFE.
      * Logs only what it has already made safe.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-SSN-MASKED       PIC X(11).
       01 WS-HASHED-PWD       PIC X(64).
       01 WS-REC-COUNT        PIC 9(6).
       PROCEDURE DIVISION.
           DISPLAY WS-SSN-MASKED
           DISPLAY WS-HASHED-PWD
           DISPLAY WS-REC-COUNT
           GOBACK.
