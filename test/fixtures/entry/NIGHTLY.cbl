       IDENTIFICATION DIVISION.
       PROGRAM-ID. NIGHTLY.
      * Run by a job step with its PARM.
       DATA DIVISION.
       LINKAGE SECTION.
       01 LK-PARM.
          05 LK-LEN           PIC S9(4) COMP.
          05 LK-TEXT          PIC X(80).
       PROCEDURE DIVISION USING LK-PARM.
           CALL 'SYSTEM' USING LK-TEXT
           GOBACK.
