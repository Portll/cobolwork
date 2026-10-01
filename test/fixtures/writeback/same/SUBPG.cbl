       IDENTIFICATION DIVISION.
       PROGRAM-ID. SUBPG.
       DATA DIVISION.
       LINKAGE SECTION.
       01 LK-A               PIC X(40).
       01 LK-B               PIC X(40).
       PROCEDURE DIVISION USING LK-A LK-B.
           MOVE LK-A TO LK-B
           GOBACK.
