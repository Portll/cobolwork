       IDENTIFICATION DIVISION.
       PROGRAM-ID. C78TEST.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       78  C-TARGET                       VALUE "CS00002S".
       01  WS-DYN                 PIC X(8) VALUE SPACES.
       PROCEDURE DIVISION.
           CALL C-TARGET.
           CALL "PADDED  ".
           CALL WS-DYN.
           STOP RUN.
